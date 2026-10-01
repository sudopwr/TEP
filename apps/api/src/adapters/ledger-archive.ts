import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  ArchiveUnreadableError,
  LedgerNotEmptyError,
  type CurrencyRegistry,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import {
  ARCHIVE_FORMAT,
  DUMP_VERSION,
  currenciesUsed,
  fromDump,
  ledgerDumpSchema,
  toDump,
  type LedgerDump,
} from './ledger-dump';
import { bulkLoad, clearLedger, countRows, snapshot } from './maintenance';
import { TarFormatError, packTar, unpackTar, type TarEntry } from './tar';

/**
 * F33 — the whole ledger and every document in one file, and back again.
 *
 * `npm run backup` already copies `data/`, and that remains the right thing for
 * a scheduled backup on the machine itself. This is the other half: a file the
 * owner can download from the running application, keep somewhere else, and
 * load into a fresh install — which is what moving to a new laptop, or trusting
 * the thing at all, actually requires.
 *
 * The archive is `.tar.gz` and holds three kinds of thing:
 *
 *     manifest.json              what this is, and what to expect
 *     ledger.json                every row, as JSON (see `ledger-dump.ts`)
 *     files/<stored path>        the documents, byte for byte
 *
 * In that order, so a reader can refuse an unknown version before it has read a
 * hundred megabytes of PDFs. The manifest's counts are a courtesy for a person
 * reading the archive; nothing trusts them, and `ledger.json` is the authority.
 *
 * **What is not in it**: the `users` row, its password hash and its sessions
 * (§5a — an export is a file that leaves the machine, and a credential has no
 * business in one), the `currencies` table (§6's scales come from the
 * migrations and are identical in every install) and the schema itself. A
 * restore therefore lands in whatever install it is given, signs nobody in or
 * out, and leaves the owner's own password alone.
 */

const MANIFEST = 'manifest.json';
const LEDGER = 'ledger.json';
const FILES = 'files/';

export interface ArchiveManifest {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly version: number;
  /** When the archive was written, ISO 8601 with a `Z`. */
  readonly createdAt: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly files: {
    /** Documents whose bytes are in the archive. */
    readonly included: number;
    /**
     * Rows whose file was not on disk to include.
     *
     * Not an error: the legacy import (F12) creates document rows from
     * filenames in the sheet with no bytes behind them, and those rows are
     * worth keeping. The number is here so a restore can say so out loud
     * rather than leaving the owner to wonder.
     */
     readonly missing: number;
  };
}

export interface ExportedArchive {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: ArchiveManifest;
}

/** What the store has to offer for an export, and no more. */
export interface ArchiveFileStore {
  read(storedPath: string): Promise<Uint8Array>;
  exists(storedPath: string): Promise<boolean>;
  /**
   * Write bytes at the path the row already names.
   *
   * Beyond the `DocumentStore` port on purpose, next to `openReadStream` and
   * for the same kind of reason: `put` *derives* the path from the content
   * hash, and a restore has to reproduce the path its `documents` row points
   * at. The adapter's own root guard applies, which is what stops a tampered
   * archive writing outside `data/files`.
   */
  restore(storedPath: string, bytes: Uint8Array): Promise<void>;
}

/** `payout-tracker-2026-10-01.tar.gz` — sorts chronologically, no colons. */
export function archiveFilename(now: Date): string {
  return `payout-tracker-${now.toISOString().slice(0, 10)}.tar.gz`;
}

function countsOf(dump: LedgerDump): Readonly<Record<string, number>> {
  return {
    traders: dump.traders.length,
    companies: dump.companies.length,
    accounts: dump.accounts.length,
    payouts: dump.payouts.length,
    transactions: dump.transactions.length,
    fees: dump.fees.length,
    feeSchedules: dump.feeSchedules.length,
    documents: dump.documents.length,
    documentLinks: dump.documentLinks.length,
  };
}

function json(value: unknown): Uint8Array {
  // Indented, because an archive somebody can read is an archive somebody can
  // check. Gzip gives the whitespace back.
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Read the ledger out and pack it.
 *
 * The documents are read one at a time rather than all at once: the archive is
 * already held in memory, and holding a second copy of every file beside it
 * would double the peak for no gain.
 */
export async function exportLedger(options: {
  readonly database: SqliteDatabase;
  readonly currencies: CurrencyRegistry;
  readonly files: ArchiveFileStore;
  readonly now?: Date;
}): Promise<ExportedArchive> {
  const now = options.now ?? new Date();
  const dump = toDump(snapshot(options.database, options.currencies));

  const documents: TarEntry[] = [];
  let missing = 0;

  for (const document of dump.documents) {
    if (await options.files.exists(document.storedPath)) {
      documents.push({
        name: `${FILES}${document.storedPath}`,
        bytes: await options.files.read(document.storedPath),
      });
    } else {
      missing += 1;
    }
  }

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: DUMP_VERSION,
    createdAt: now.toISOString(),
    counts: countsOf(dump),
    files: { included: documents.length, missing },
  };

  const packed = packTar(
    [
      { name: MANIFEST, bytes: json(manifest) },
      { name: LEDGER, bytes: json(dump) },
      ...documents,
    ],
    Math.floor(now.getTime() / 1000),
  );

  return {
    filename: archiveFilename(now),
    bytes: new Uint8Array(gzipSync(packed)),
    manifest,
  };
}

export interface ImportedArchive {
  readonly manifest: ArchiveManifest;
  readonly counts: Readonly<Record<string, number>>;
  /** Files written. Equal to the archive's own count, or it threw. */
  readonly filesRestored: number;
  /** What was in the ledger before this replaced it. */
  readonly replaced: Readonly<Record<string, number>>;
}

function unreadable(message: string, cause?: unknown): ArchiveUnreadableError {
  return new ArchiveUnreadableError(message, cause);
}

function entriesOf(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  let unpacked: readonly TarEntry[];

  try {
    unpacked = unpackTar(new Uint8Array(gunzipSync(archive)));
  } catch (cause) {
    if (cause instanceof TarFormatError) {
      throw unreadable(cause.message, cause);
    }
    throw unreadable(
      'This file is not a payout tracker export: it is not a gzipped tar ' +
        'archive. Choose the .tar.gz file the export produced.',
      cause,
    );
  }

  return new Map(unpacked.map((entry) => [entry.name, entry.bytes]));
}

function manifestOf(entries: ReadonlyMap<string, Uint8Array>): ArchiveManifest {
  const raw = entries.get(MANIFEST);

  if (raw === undefined) {
    throw unreadable(
      `This archive has no ${MANIFEST}, so it was not written by this application.`,
    );
  }

  let parsed: ArchiveManifest;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as ArchiveManifest;
  } catch (cause) {
    throw unreadable(`${MANIFEST} in this archive is not valid JSON.`, cause);
  }

  if (parsed.format !== ARCHIVE_FORMAT) {
    throw unreadable(
      'This archive was written by something else. Choose the .tar.gz file ' +
        'the export produced.',
    );
  }

  if (parsed.version > DUMP_VERSION) {
    throw unreadable(
      `This archive was written by a newer version of the application ` +
        `(format ${String(parsed.version)}, and this one reads ${String(DUMP_VERSION)}). ` +
        'Update, then import it again.',
    );
  }

  return parsed;
}

function dumpOf(entries: ReadonlyMap<string, Uint8Array>): LedgerDump {
  const raw = entries.get(LEDGER);

  if (raw === undefined) {
    throw unreadable(`This archive has no ${LEDGER}, so there is nothing to import.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (cause) {
    throw unreadable(`${LEDGER} in this archive is not valid JSON.`, cause);
  }

  const checked = ledgerDumpSchema.safeParse(parsed);

  if (!checked.success) {
    const first = checked.error.issues[0];
    throw unreadable(
      `${LEDGER} in this archive is not the shape this version reads` +
        (first === undefined
          ? '.'
          : `: ${first.path.join('.')} ${first.message}.`),
      checked.error,
    );
  }

  return checked.data;
}

/**
 * Check the bytes against the hash the row claims, before writing anything.
 *
 * A document is identified by its content (UC4), so a file whose bytes do not
 * hash to what its row says is either damaged in transit or has been swapped —
 * and either way the restored ledger would point at something that is not the
 * evidence it names. Rows with no hash are the legacy import's references
 * (F12), which never had bytes to check.
 */
function verifyFiles(
  dump: LedgerDump,
  entries: ReadonlyMap<string, Uint8Array>,
): readonly { readonly storedPath: string; readonly bytes: Uint8Array }[] {
  const files: { storedPath: string; bytes: Uint8Array }[] = [];

  for (const document of dump.documents) {
    /*
      A stored path has to be a relative path under `data/files` and nothing
      cleverer. The store's own root guard refuses an escape as well, and
      belongs there — but it throws a sentence written for a programmer, and
      the owner holding a tampered archive deserves to be told what is wrong
      with it rather than shown a 500.
    */
    if (
      document.storedPath.includes('..') ||
      document.storedPath.startsWith('/') ||
      document.storedPath.includes('\\') ||
      /^[a-zA-Z]:/.test(document.storedPath)
    ) {
      throw unreadable(
        `This archive stores '${document.filename}' at '${document.storedPath}', ` +
          'which is not a path inside the file store. Nothing has been changed.',
      );
    }

    const bytes = entries.get(`${FILES}${document.storedPath}`);

    if (bytes === undefined) continue;

    if (document.sha256 !== null) {
      const actual = createHash('sha256').update(bytes).digest('hex');

      if (actual !== document.sha256) {
        throw unreadable(
          `'${document.filename}' in this archive does not match its recorded ` +
            'checksum, so the archive is damaged. Nothing has been changed.',
        );
      }
    }

    files.push({ storedPath: document.storedPath, bytes });
  }

  return files;
}

/**
 * Replace the ledger with the contents of an archive.
 *
 * The order is the whole of the safety here:
 *
 *  1. unpack, parse and validate — nothing has been touched yet, so every
 *     refusal above this line leaves the ledger exactly as it was;
 *  2. check that every currency the archive names exists in this install;
 *  3. build every entity through its own constructor (§7's invariants);
 *  4. write the files, which is additive and content-addressed, so a failure
 *     here has destroyed nothing;
 *  5. in one transaction, empty the ledger and load the graph.
 *
 * Step 5 is a single SQLite transaction, so a restore either happens or does
 * not. A file written in step 4 for an import that then failed is a few
 * unreferenced kilobytes in a content-addressed store — the same thing
 * `DeleteDocument` tolerates, and the opposite mistake of deleting the one copy
 * of a statement.
 *
 * `replace` has to be asked for when the ledger is not empty. An import is a
 * replacement, not a merge: two ledgers that both number their payouts from 1
 * cannot be put side by side without renumbering, and renumbering silently is
 * how a reference in a note stops pointing at anything.
 */
export async function importLedger(options: {
  readonly database: SqliteDatabase;
  readonly currencies: CurrencyRegistry;
  readonly files: ArchiveFileStore;
  readonly archive: Uint8Array;
  readonly replace?: boolean;
}): Promise<ImportedArchive> {
  const entries = entriesOf(options.archive);
  const manifest = manifestOf(entries);
  const dump = dumpOf(entries);

  const missingCurrencies = currenciesUsed(dump).filter((code) => {
    try {
      options.currencies.get(code);
      return false;
    } catch {
      return true;
    }
  });

  if (missingCurrencies.length > 0) {
    throw unreadable(
      `This archive uses ${missingCurrencies.join(', ')}, which this ` +
        'installation does not know. Nothing has been changed.',
    );
  }

  const replaced = ledgerCounts(options.database);
  const occupied = Object.values(replaced).some((count) => count > 0);

  if (occupied && options.replace !== true) {
    throw new LedgerNotEmptyError(replaced);
  }

  const graph = fromDump(dump, options.currencies);
  const files = verifyFiles(dump, entries);

  for (const file of files) {
    await options.files.restore(file.storedPath, file.bytes);
  }

  const load = options.database.transaction(() => {
    clearLedger(options.database);
    bulkLoad(options.database, graph);
  });

  load();

  return {
    manifest,
    counts: countsOf(dump),
    filesRestored: files.length,
    replaced,
  };
}

/** What is on file now, in the same words the manifest uses. */
export function ledgerCounts(
  database: SqliteDatabase,
): Readonly<Record<string, number>> {
  return {
    traders: countRows(database, 'traders'),
    companies: countRows(database, 'companies'),
    accounts: countRows(database, 'accounts'),
    payouts: countRows(database, 'payouts'),
    transactions: countRows(database, 'transactions'),
    fees: countRows(database, 'transaction_fees'),
    feeSchedules: countRows(database, 'fee_schedules'),
    documents: countRows(database, 'documents'),
    documentLinks: countRows(database, 'document_links'),
  };
}
