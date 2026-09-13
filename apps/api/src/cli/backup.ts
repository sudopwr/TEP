import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { openDatabase } from '../db/connection';

const USAGE = `
Usage: npm run backup

Writes a timestamped copy of everything in data/ to backups/, using SQLite's
own backup API so the copy is consistent even while the application is
running. Safe to run at any time; nothing is locked and nothing is deleted.

Environment:
  PAYOUT_DB       database to copy   (default: data/app.db)
  PAYOUT_FILES    files to copy      (default: data/files)
  PAYOUT_BACKUPS  where to write     (default: backups)
`.trim();

/**
 * `2026-09-13T07-42-19Z`.
 *
 * ISO order, so `ls` sorts chronologically, with the colons taken out —
 * Windows refuses them in a filename, and a backup script that only works on
 * one operating system is a backup script that will be found not to work at
 * the worst possible moment.
 */
export function backupStamp(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

/**
 * Copy a live SQLite database through its own backup API.
 *
 * **Not a file copy, and this is the whole reason the script exists.** The
 * database runs in WAL mode, which means the newest committed pages may be
 * sitting in `app.db-wal` and not in `app.db` at all. Copying the three files
 * with `cp` gives you whatever each of them happened to contain at the moment
 * it was read — three snapshots from three different instants, which is not a
 * database. It will often open, and it will sometimes be missing the last
 * transaction, and you will not find out until you need it.
 *
 * `better-sqlite3`'s `backup` drives SQLite's online backup API, which walks
 * the pages under a read transaction and writes a single consistent file with
 * the WAL already folded in. The result is one `app.db` with no sidecars, so
 * restoring it is a copy.
 */
async function copyDatabase(from: string, to: string): Promise<number> {
  const database = openDatabase(from);

  try {
    await database.backup(to);
  } finally {
    database.close();
  }

  return statSync(to).size;
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const databasePath =
    process.env['PAYOUT_DB'] ?? path.resolve('data', 'app.db');
  const filesRoot =
    process.env['PAYOUT_FILES'] ?? path.resolve('data', 'files');
  const backupsRoot = process.env['PAYOUT_BACKUPS'] ?? path.resolve('backups');

  if (!existsSync(databasePath)) {
    process.stderr.write(
      `There is no database at ${databasePath}, so there is nothing to back up.\n` +
        'Run the application once, or set PAYOUT_DB.\n',
    );
    return 1;
  }

  const destination = path.join(backupsRoot, backupStamp());

  if (existsSync(destination)) {
    // One second's resolution, so two runs in the same second would otherwise
    // overwrite each other. Refusing is the safe direction for a backup.
    process.stderr.write(
      `${destination} already exists. Wait a second and run it again.\n`,
    );
    return 1;
  }

  mkdirSync(destination, { recursive: true });

  const lines: string[] = [`Backing up to ${destination}`];

  const size = await copyDatabase(databasePath, path.join(destination, 'app.db'));
  lines.push(`  app.db   ${megabytes(size)} (via the SQLite backup API)`);

  if (existsSync(filesRoot)) {
    /*
      The attached files are copied, and that is correct for them: each one is
      written once under a content-addressed path and never modified, so there
      is no half-written state to catch. It is only the database that has a
      write-ahead log.
    */
    cpSync(filesRoot, path.join(destination, 'files'), { recursive: true });
    lines.push('  files/   copied');
  } else {
    lines.push('  files/   nothing attached yet');
  }

  lines.push(
    '',
    'To restore: stop the application, then copy app.db and files/ back into',
    'data/, replacing what is there. Nothing else is needed — the copy has no',
    'sidecar files and no pending log.',
  );

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith('backup.ts') === true;

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
