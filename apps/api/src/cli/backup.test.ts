import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildContainer } from '../container';
import { openDatabase, type SqliteDatabase } from '../db/connection';
import { migrate } from '../db/migrate';

import { backupStamp, main } from './backup';

/**
 * The backup, and the one thing it exists to get right.
 *
 * N6 says a backup is a copy of `data/`, and that is true of the attached
 * files — each is written once under a content-addressed path and never
 * touched again. It is *not* true of the database. `journal_mode = WAL` means
 * the newest committed pages may be in `app.db-wal` and not in `app.db` at
 * all, so copying the files gives three snapshots from three different
 * instants. The result usually opens. It sometimes has yesterday's data in it.
 *
 * Everything below reads the database through the application's own use
 * cases rather than through SQL. That is not only §12's rule: a backup you
 * can open is not the claim worth making, and "the restored copy answers
 * `ListCompanies` with the company that was recorded" is.
 */

/** What the application can see in a database at this path. */
async function companiesIn(location: string): Promise<readonly string[]> {
  const database = openDatabase(location);

  try {
    const listed = await buildContainer(database).useCases.listCompanies.execute();
    return listed.map((company) => company.code);
  } finally {
    database.close();
  }
}

describe('backupStamp', () => {
  it('sorts chronologically and contains nothing Windows refuses', () => {
    const stamp = backupStamp(new Date('2026-09-13T07:42:19.512Z'));

    expect(stamp).toBe('2026-09-13T07-42-19Z');
    expect(stamp).not.toContain(':');
  });
});

describe('npm run backup', () => {
  let directory: string;
  let databasePath: string;
  let filesRoot: string;
  let backupsRoot: string;
  let live: SqliteDatabase;

  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'payout-backup-'));
    databasePath = path.join(directory, 'app.db');
    filesRoot = path.join(directory, 'files');
    backupsRoot = path.join(directory, 'backups');

    process.env['PAYOUT_DB'] = databasePath;
    process.env['PAYOUT_FILES'] = filesRoot;
    process.env['PAYOUT_BACKUPS'] = backupsRoot;

    live = openDatabase(databasePath);
    migrate(live);

    // A company recorded and left in the write-ahead log: no checkpoint has
    // run, because SQLite's automatic one waits for a thousand pages.
    await buildContainer(live).useCases.recordCompany.execute({
      code: 'Tradeify001',
      name: 'Tradeify',
    });

    mkdirSync(filesRoot, { recursive: true });
    writeFileSync(path.join(filesRoot, 'statement.pdf'), '%PDF-1.4 evidence');
  });

  afterEach(() => {
    live.close();
    rmSync(directory, { recursive: true, force: true });
    delete process.env['PAYOUT_DB'];
    delete process.env['PAYOUT_FILES'];
    delete process.env['PAYOUT_BACKUPS'];
    out.mockClear();
    err.mockClear();
  });

  /** The single directory a run produced. */
  const theBackup = (): string => {
    const [only, ...extra] = readdirSync(backupsRoot);
    expect(extra).toEqual([]);
    expect(only).toBeDefined();
    return path.join(backupsRoot, only as string);
  };

  it('the scenario is real: the data is in the log, not in the file', () => {
    // If this ever stops being true the test below stops proving anything, so
    // it is asserted rather than assumed.
    const wal = `${databasePath}-wal`;

    expect(existsSync(wal)).toBe(true);
    expect(statSync(wal).size).toBeGreaterThan(0);
  });

  it('a plain file copy is not a working database at all', async () => {
    /*
      The failure the SQLite backup API exists to avoid, demonstrated rather
      than described. This is what `cp data/app.db` gives you — and it is worse
      than stale: with nothing checkpointed yet, the copy has no schema either.
      It opens perfectly happily and is empty, which is the most dangerous
      shape a bad backup can take, because it looks like a backup.
    */
    const naive = path.join(directory, 'naive.db');
    copyFileSync(databasePath, naive);

    await expect(companiesIn(naive)).rejects.toThrow(/no such table/i);

    // And what the backup gives you instead.
    expect(await main([])).toBe(0);

    await expect(companiesIn(path.join(theBackup(), 'app.db'))).resolves.toEqual(
      ['Tradeify001'],
    );
  });

  it('writes one consistent file with no sidecars to carry', async () => {
    // The point of a folded-in WAL: restoring is a copy, not a ritual.
    expect(await main([])).toBe(0);

    const written = readdirSync(theBackup()).sort();

    expect(written).toEqual(['app.db', 'files']);
  });

  it('brings the attached files with it', async () => {
    // N6: the data is the database *and* the files. Half a backup is worse
    // than none, because it looks like a whole one.
    expect(await main([])).toBe(0);

    expect(existsSync(path.join(theBackup(), 'files', 'statement.pdf'))).toBe(
      true,
    );
  });

  it('leaves the live database running and writable', async () => {
    // A backup that needs the application stopped is a backup nobody takes.
    expect(await main([])).toBe(0);

    await buildContainer(live).useCases.recordCompany.execute({
      code: 'Rise001',
      name: 'Rise',
    });

    await expect(companiesIn(databasePath)).resolves.toHaveLength(2);
    // And the backup is a snapshot of when it ran, not a live mirror.
    await expect(
      companiesIn(path.join(theBackup(), 'app.db')),
    ).resolves.toHaveLength(1);
  });

  it('says where it went and how to put it back', async () => {
    expect(await main([])).toBe(0);

    const said = out.mock.calls.map(([text]) => String(text)).join('');

    expect(said).toContain('SQLite backup API');
    expect(said).toContain('To restore');
  });

  it('refuses rather than overwriting a backup from the same second', async () => {
    expect(await main([])).toBe(0);
    expect(await main([])).toBe(1);

    expect(readdirSync(backupsRoot)).toHaveLength(1);
    expect(err.mock.calls.map(([text]) => String(text)).join('')).toContain(
      'already exists',
    );
  });

  it('says so when there is no database yet', async () => {
    live.close();
    rmSync(directory, { recursive: true, force: true });

    expect(await main([])).toBe(1);
    expect(err.mock.calls.map(([text]) => String(text)).join('')).toContain(
      'nothing to back up',
    );

    // So the afterEach has something to close.
    mkdirSync(directory, { recursive: true });
    live = openDatabase(databasePath);
  });
});
