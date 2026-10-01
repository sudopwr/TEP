import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { ArchiveUnreadableError, LedgerNotEmptyError } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqliteDatabase } from '../db/connection';

import { openTestDatabase } from '../../test/open-test-database';
import { seedReferencePayout } from '../../test/build-test-server';

import { loadCurrencyRegistry } from './currency-registry';
import { FileSystemDocumentStore } from './filesystem-document-store';
import {
  archiveFilename,
  exportLedger,
  importLedger,
  ledgerCounts,
} from './ledger-archive';
import { toDump } from './ledger-dump';
import { clearLedger, countRows, snapshot } from './maintenance';
import { SqliteDocumentRepository } from './sqlite-document-repository';
import { packTar, unpackTar } from './tar';

/**
 * F33 end to end at the adapter level: out of one ledger and into another.
 *
 * Two databases and two file stores, because that is what the feature is for.
 * A round trip through the same database would pass with half the code missing
 * — the ids would already be there, the files would already be on disk — and
 * the question worth answering is whether a *fresh install* given this one file
 * ends up holding the same ledger.
 */

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const STATEMENT = bytes('%PDF-1.4 the coindcx march statement');
const SCREENSHOT = bytes('\x89PNG\r\n\x1a\n a wallet screenshot');

interface World {
  readonly database: SqliteDatabase;
  readonly files: FileSystemDocumentStore;
  readonly currencies: ReturnType<typeof loadCurrencyRegistry>;
}

const roots: string[] = [];

function emptyWorld(): World {
  const root = mkdtempSync(path.join(tmpdir(), 'payout-archive-'));
  roots.push(root);

  const database = openTestDatabase();

  return {
    database,
    files: new FileSystemDocumentStore(root),
    currencies: loadCurrencyRegistry(database),
  };
}

/** §10's ledger, with two documents attached and linked where they belong. */
async function seededWorld(): Promise<World> {
  const world = emptyWorld();
  seedReferencePayout(world.database);

  const documents = new SqliteDocumentRepository(world.database);

  const statement = await world.files.put(STATEMENT, 'coindcx-march.pdf');
  const one = await documents.insert({
    filename: 'coindcx-march.pdf',
    storedPath: statement.storedPath,
    mimeType: 'application/pdf',
    byteSize: statement.byteSize,
    sha256: statement.sha256,
    docType: 'statement',
    docDate: '2025-03-31',
    extractedText: 'TDS deducted 868.88',
  });
  await documents.link(one.id, { kind: 'transaction', id: 3 }, 'proof');
  await documents.link(one.id, { kind: 'payout', id: 1 }, null);

  const shot = await world.files.put(SCREENSHOT, 'wallet.png');
  const two = await documents.insert({
    filename: 'wallet.png',
    storedPath: shot.storedPath,
    mimeType: 'image/png',
    byteSize: shot.byteSize,
    sha256: shot.sha256,
    docType: 'screenshot',
    docDate: null,
    extractedText: null,
  });
  await documents.link(two.id, { kind: 'company', id: 1 }, 'contract');

  return world;
}

afterEach(() => {
  // The databases are `:memory:`; the directories are not, but they are in the
  // OS temp root and holding them open is what a leaked handle looks like.
  roots.length = 0;
});

describe('exportLedger', () => {
  let world: World;

  beforeEach(async () => {
    world = await seededWorld();
  });

  const unpack = async () =>
    new Map(
      unpackTar(
        new Uint8Array(
          gunzipSync((await exportLedger({ ...world, files: world.files })).bytes),
        ),
      ).map((entry) => [entry.name, entry.bytes]),
    );

  it('writes a gzipped tar holding the manifest, the ledger and the files', async () => {
    const entries = await unpack();

    expect([...entries.keys()]).toEqual([
      'manifest.json',
      'ledger.json',
      // Content-addressed paths, exactly as `documents.stored_path` records
      // them — which is what lets a restore put the file back where its row
      // already points.
      expect.stringMatching(/^files\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\./),
      expect.stringMatching(/^files\//),
    ]);
  });

  it('puts the manifest first, so a reader can refuse before unpacking', async () => {
    const entries = await unpack();
    const manifest = JSON.parse(text(entries.get('manifest.json')!)) as {
      format: string;
      version: number;
      counts: Record<string, number>;
      files: { included: number; missing: number };
    };

    expect(manifest.format).toBe('payout-tracker-export');
    expect(manifest.version).toBe(1);
    expect(manifest.counts).toMatchObject({
      payouts: 1,
      transactions: 13,
      documents: 2,
      documentLinks: 3,
    });
    expect(manifest.files).toEqual({ included: 2, missing: 0 });
  });

  it('carries the document bytes unchanged', async () => {
    const entries = await unpack();
    const stored = [...entries.entries()].filter(([name]) =>
      name.startsWith('files/'),
    );

    expect(stored.map(([, value]) => text(value)).sort()).toEqual(
      [text(STATEMENT), text(SCREENSHOT)].sort(),
    );
  });

  it('holds no credential, because an export leaves the machine', async () => {
    // §5a: the archive is a file the owner downloads and puts somewhere else.
    // A password hash in it would be a hash in their cloud storage.
    const entries = await unpack();
    const whole = text(entries.get('ledger.json')!);

    expect(whole).not.toContain('argon2');
    expect(whole).not.toContain('password');
    expect([...entries.keys()].join(' ')).not.toContain('users');
  });

  it('counts a document whose bytes are not on disk, rather than failing', async () => {
    // F12 creates rows from filenames in the sheet with nothing behind them.
    await new SqliteDocumentRepository(world.database).insert({
      filename: 'named-in-the-sheet.pdf',
      storedPath: 'ab/cd/never-written.pdf',
      mimeType: null,
      byteSize: null,
      sha256: null,
      docType: null,
      docDate: null,
      extractedText: null,
    });

    const archive = await exportLedger(world);

    expect(archive.manifest.files).toEqual({ included: 2, missing: 1 });
    expect(archive.manifest.counts['documents']).toBe(3);
  });

  it('names the file after the day it was written', async () => {
    const archive = await exportLedger({
      ...world,
      now: new Date('2026-10-01T09:30:00.000Z'),
    });

    expect(archive.filename).toBe('payout-tracker-2026-10-01.tar.gz');
    expect(archiveFilename(new Date('2026-01-02T23:59:59.000Z'))).toBe(
      'payout-tracker-2026-01-02.tar.gz',
    );
  });

  it('exports an empty ledger as an archive of nothing', async () => {
    // The uninteresting case that must not throw: a fresh install, exported
    // before anything is recorded, is a valid archive holding no rows.
    const fresh = emptyWorld();
    clearLedger(fresh.database);

    const archive = await exportLedger(fresh);

    expect(archive.manifest.counts).toMatchObject({ payouts: 0, traders: 0 });
    expect(archive.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('importLedger', () => {
  let source: World;
  let archive: Uint8Array;

  beforeEach(async () => {
    source = await seededWorld();
    archive = (await exportLedger(source)).bytes;
  });

  it('reproduces the whole ledger in a fresh install, field for field', async () => {
    /*
      The assertion the feature exists for.

      `toDump` is every row of every table as plain JSON, so comparing two of
      them compares ids, amounts, currencies, rates, dates, references, wallet
      addresses, notes, document rows and every attachment — in one line, with
      nothing left to forget. A missing column here is a failed test rather
      than a quiet loss discovered on the day somebody needs the archive.
    */
    const target = emptyWorld();
    clearLedger(target.database);

    const restored = await importLedger({ ...target, archive });

    expect(restored.counts['transactions']).toBe(13);
    expect(restored.filesRestored).toBe(2);
    expect(toDump(snapshot(target.database, target.currencies))).toEqual(
      toDump(snapshot(source.database, source.currencies)),
    );
  });

  it('puts the files back where their rows point', async () => {
    const target = emptyWorld();
    clearLedger(target.database);

    await importLedger({ ...target, archive });

    const documents = snapshot(
      target.database,
      target.currencies,
    ).documents;

    for (const document of documents) {
      await expect(target.files.exists(document.storedPath)).resolves.toBe(
        true,
      );
    }
    expect(text(await target.files.read(documents[0]!.storedPath))).toBe(
      text(STATEMENT),
    );
  });

  it('keeps the attachments, so the restored files are attached to something', async () => {
    // Without `document_links` a restore holds every file and shows none of
    // them: the rows survive and nothing points at them.
    const target = emptyWorld();
    clearLedger(target.database);

    await importLedger({ ...target, archive });

    expect(countRows(target.database, 'document_links')).toBe(3);
    const links = snapshot(target.database, target.currencies).documentLinks;
    expect(links.map((link) => link.target)).toEqual([
      { kind: 'transaction', id: 3 },
      { kind: 'payout', id: 1 },
      { kind: 'company', id: 1 },
    ]);
    expect(links[0]?.role).toBe('proof');
  });

  it('leaves the restored documents searchable', async () => {
    // FTS5 is an external-content index kept by triggers. `bulkLoad` inserts
    // into `documents`, so `documents_ai` fires and the index is built — but
    // that is a thing to prove rather than assume.
    const target = emptyWorld();
    clearLedger(target.database);

    await importLedger({ ...target, archive });

    const found = await new SqliteDocumentRepository(target.database).search(
      '868.88',
    );

    expect(found.map((document) => document.filename)).toEqual([
      'coindcx-march.pdf',
    ]);
  });

  it('refuses to replace a ledger that has data unless asked', async () => {
    const target = await seededWorld();

    await expect(importLedger({ ...target, archive })).rejects.toThrow(
      LedgerNotEmptyError,
    );
    // And nothing was touched: the counts are what they were.
    expect(countRows(target.database, 'payouts')).toBe(1);
  });

  it('says what it would be replacing, so the question can name it', async () => {
    const target = await seededWorld();

    await expect(importLedger({ ...target, archive })).rejects.toMatchObject({
      counts: { payouts: 1, transactions: 13, documents: 2 },
    });
  });

  it('replaces when told to, leaving nothing of the old ledger behind', async () => {
    const target = await seededWorld();
    // A second payout, which the archive does not have: after the import it
    // must be gone, not merged.
    const second = emptyWorld();
    clearLedger(second.database);

    const restored = await importLedger({
      ...target,
      archive,
      replace: true,
    });

    expect(restored.replaced['payouts']).toBe(1);
    expect(countRows(target.database, 'payouts')).toBe(1);
    expect(toDump(snapshot(target.database, target.currencies))).toEqual(
      toDump(snapshot(source.database, source.currencies)),
    );
    expect(countRows(second.database, 'payouts')).toBe(0);
  });

  it('refuses a file that is not an archive, and changes nothing', async () => {
    const target = await seededWorld();

    await expect(
      importLedger({
        ...target,
        archive: bytes('%PDF-1.4 this is a statement, not an export'),
        replace: true,
      }),
    ).rejects.toThrow(ArchiveUnreadableError);
    expect(countRows(target.database, 'payouts')).toBe(1);
  });

  it('refuses a tar that is not one of ours', async () => {
    const target = emptyWorld();
    clearLedger(target.database);

    await expect(
      importLedger({
        ...target,
        archive: new Uint8Array(
          gzipSync(packTar([{ name: 'notes.txt', bytes: bytes('hello') }], 0)),
        ),
      }),
    ).rejects.toThrow(/no manifest.json/);
  });

  it('refuses an archive from a newer version rather than guessing', async () => {
    const target = emptyWorld();
    clearLedger(target.database);

    await expect(
      importLedger({ ...target, archive: rewritten(archive, { version: 99 }) }),
    ).rejects.toThrow(/newer version/);
  });

  it('refuses an archive whose ledger is the wrong shape', async () => {
    const target = emptyWorld();
    clearLedger(target.database);

    const broken = repack(archive, (entries) => {
      entries.set('ledger.json', bytes('{"payouts":[{"id":"one"}]}'));
      return entries;
    });

    await expect(importLedger({ ...target, archive: broken })).rejects.toThrow(
      /not the shape this version reads/,
    );
  });

  it('refuses a document whose bytes do not match its checksum', async () => {
    /*
      A document is identified by its content (UC4). Bytes that do not hash to
      what the row claims mean the archive is damaged or has been swapped, and
      a restored ledger pointing at something that is not the evidence it names
      is worse than a refused import.
    */
    const target = emptyWorld();
    clearLedger(target.database);

    const tampered = repack(archive, (entries) => {
      for (const name of entries.keys()) {
        if (name.startsWith('files/')) {
          entries.set(name, bytes('something else entirely'));
          break;
        }
      }
      return entries;
    });

    await expect(
      importLedger({ ...target, archive: tampered }),
    ).rejects.toThrow(/does not match its recorded checksum/);
    expect(countRows(target.database, 'documents')).toBe(0);
  });

  it('refuses a stored path that tries to leave the file store', async () => {
    /*
      The oldest trick in archive extraction, refused twice: here, by name,
      with a sentence the owner can act on — and again inside
      `FileSystemDocumentStore`, whose root guard is the reason `restore` lives
      there rather than in this file.
    */
    const target = emptyWorld();
    clearLedger(target.database);

    const escaping = repack(archive, (entries) => {
      const ledger = JSON.parse(text(entries.get('ledger.json')!)) as {
        documents: { storedPath: string; sha256: string | null }[];
      };
      const first = ledger.documents[0]!;
      const was = `files/${first.storedPath}`;
      first.storedPath = '../../../escaped.pdf';
      first.sha256 = null;

      const moved = entries.get(was)!;
      entries.delete(was);
      entries.set('files/../../../escaped.pdf', moved);
      entries.set('ledger.json', bytes(JSON.stringify(ledger)));
      return entries;
    });

    await expect(
      importLedger({ ...target, archive: escaping }),
    ).rejects.toThrow(/not a path inside the file store/);
    expect(countRows(target.database, 'documents')).toBe(0);
  });

  it('refuses an archive naming a currency this install does not have', async () => {
    const target = emptyWorld();
    clearLedger(target.database);

    const foreign = repack(archive, (entries) => {
      entries.set(
        'ledger.json',
        bytes(
          text(entries.get('ledger.json')!).replaceAll('"USDT"', '"DOGE"'),
        ),
      );
      return entries;
    });

    await expect(
      importLedger({ ...target, archive: foreign }),
    ).rejects.toThrow(/DOGE/);
  });

  it('imports an archive of nothing into a ledger of nothing', async () => {
    const empty = emptyWorld();
    clearLedger(empty.database);
    const nothing = (await exportLedger(empty)).bytes;

    const target = emptyWorld();
    clearLedger(target.database);

    const restored = await importLedger({ ...target, archive: nothing });

    expect(restored.counts['payouts']).toBe(0);
    expect(restored.filesRestored).toBe(0);
  });

  it('leaves the sign-in account alone', async () => {
    // §5a: a restore is not a way to sign in or out. The archive carries no
    // credential, and the one on this machine is untouched by an import.
    const target = await seededWorld();
    const before = countRows(target.database, 'schema_migrations');

    await importLedger({ ...target, archive, replace: true });

    expect(
      Number(
        target.database
          .prepare<[], { total: number | bigint }>(
            'SELECT COUNT(*) AS total FROM users',
          )
          .get()?.total ?? 0,
      ),
    ).toBe(1);
    expect(countRows(target.database, 'schema_migrations')).toBe(before);
  });

  it('can be imported twice, landing in the same place', async () => {
    // Idempotent in the way that matters: restoring the same archive again
    // produces the same ledger rather than doubling anything.
    const target = emptyWorld();
    clearLedger(target.database);

    await importLedger({ ...target, archive });
    const once = toDump(snapshot(target.database, target.currencies));

    await importLedger({ ...target, archive, replace: true });

    expect(toDump(snapshot(target.database, target.currencies))).toEqual(once);
  });
});

describe('ledgerCounts', () => {
  it('counts what is on file, table by table', async () => {
    const world = await seededWorld();

    expect(ledgerCounts(world.database)).toMatchObject({
      traders: 1,
      companies: 2,
      accounts: 5,
      payouts: 1,
      transactions: 13,
      documents: 2,
      documentLinks: 3,
    });
  });

  it('is all zeros on a fresh ledger', () => {
    const world = emptyWorld();
    clearLedger(world.database);

    expect(Object.values(ledgerCounts(world.database))).toEqual(
      Array.from({ length: 9 }, () => 0),
    );
  });
});

// ---------- helpers that take an archive apart and put it back ----------

/** Unpack, let a test change the entries, and pack again. */
function repack(
  archive: Uint8Array,
  change: (entries: Map<string, Uint8Array>) => Map<string, Uint8Array>,
): Uint8Array {
  const entries = new Map(
    unpackTar(new Uint8Array(gunzipSync(archive))).map((entry) => [
      entry.name,
      entry.bytes,
    ]),
  );

  return new Uint8Array(
    gzipSync(
      packTar(
        [...change(entries)].map(([name, value]) => ({ name, bytes: value })),
        0,
      ),
    ),
  );
}

/** The same archive with its manifest edited. */
function rewritten(
  archive: Uint8Array,
  changes: Record<string, unknown>,
): Uint8Array {
  return repack(archive, (entries) => {
    const manifest = JSON.parse(text(entries.get('manifest.json')!)) as Record<
      string,
      unknown
    >;
    entries.set(
      'manifest.json',
      bytes(JSON.stringify({ ...manifest, ...changes })),
    );
    return entries;
  });
}
