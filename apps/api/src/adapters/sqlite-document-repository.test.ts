import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arrangeReferencePayout } from '../../test/arrange';
import type { SqliteDatabase } from '../db/connection';

import {
  SqliteDocumentRepository,
  toFtsPhrase,
} from './sqlite-document-repository';

describe('SqliteDocumentRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteDocumentRepository;

  beforeEach(() => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;
    repository = new SqliteDocumentRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  const draft = (overrides: Record<string, unknown> = {}) => ({
    filename: 'coindcx-march.pdf',
    storedPath: 'ab/cd/abcd.pdf',
    mimeType: 'application/pdf',
    byteSize: 20480,
    sha256: 'a'.repeat(64),
    docType: 'statement' as const,
    docDate: '2025-03-31',
    extractedText: 'CoinDCX Statement March 2025 order 998877',
    ...overrides,
  });

  it('round-trips a document', async () => {
    const document = await repository.insert(draft());

    expect(document.id).toBe(1);
    await expect(repository.findById(document.id)).resolves.toEqual(document);
  });

  it('finds by content hash, which is what dedupes an upload', async () => {
    const document = await repository.insert(draft());

    await expect(repository.findBySha256('a'.repeat(64))).resolves.toEqual(
      document,
    );
    expect(document.sha256).toBe('a'.repeat(64));
    await expect(repository.findBySha256('b'.repeat(64))).resolves.toBeNull();
  });

  it('refuses a second document with the same hash', async () => {
    await repository.insert(draft());

    await expect(
      repository.insert(draft({ storedPath: 'other.pdf' })),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });

  describe('links', () => {
    it('links one document to all three kinds of target', async () => {
      const document = await repository.insert(draft());

      await repository.link(document.id, { kind: 'company', id: 1 }, null);
      await repository.link(document.id, { kind: 'payout', id: 1 }, 'proof');
      await repository.link(
        document.id,
        { kind: 'transaction', id: 3 },
        'proof',
      );

      await expect(
        repository.listForTarget({ kind: 'payout', id: 1 }),
      ).resolves.toEqual([document]);
      await expect(
        repository.listForTarget({ kind: 'transaction', id: 3 }),
      ).resolves.toEqual([document]);
    });

    it('is idempotent, leaning on the partial unique indexes', async () => {
      const document = await repository.insert(draft());

      await repository.link(document.id, { kind: 'payout', id: 1 }, null);
      await repository.link(document.id, { kind: 'payout', id: 1 }, null);

      await expect(
        repository.listForTarget({ kind: 'payout', id: 1 }),
      ).resolves.toHaveLength(1);
    });

    it('unlinks only the target it was given', async () => {
      const document = await repository.insert(draft());
      await repository.link(document.id, { kind: 'payout', id: 1 }, null);
      await repository.link(document.id, { kind: 'transaction', id: 3 }, null);

      await repository.unlink(document.id, { kind: 'payout', id: 1 });

      await expect(
        repository.listForTarget({ kind: 'payout', id: 1 }),
      ).resolves.toEqual([]);
      await expect(
        repository.listForTarget({ kind: 'transaction', id: 3 }),
      ).resolves.toHaveLength(1);
    });

    it('returns an empty list for a target with nothing attached', async () => {
      await expect(
        repository.listForTarget({ kind: 'company', id: 2 }),
      ).resolves.toEqual([]);
    });

    it('refuses a link to a target that does not exist', async () => {
      const document = await repository.insert(draft());

      await expect(
        repository.link(document.id, { kind: 'payout', id: 999 }, null),
      ).rejects.toMatchObject({ name: 'PayoutNotFoundError', payoutId: 999 });
    });

    it('names the kind of target that was missing', async () => {
      // The database says FOREIGN KEY; the caller needs to know *which*
      // thing it named is not there. §7 allows duplicating a constraint
      // when the message needs to be friendlier, and a 500 saying
      // "SQLITE_CONSTRAINT_FOREIGNKEY" is not friendlier than anything.
      const document = await repository.insert(draft());

      await expect(
        repository.link(document.id, { kind: 'company', id: 999 }, null),
      ).rejects.toMatchObject({ name: 'CompanyNotFoundError' });
      await expect(
        repository.link(document.id, { kind: 'transaction', id: 999 }, null),
      ).rejects.toMatchObject({ name: 'TransactionNotFoundError' });
    });

    it('lets an unrelated failure through untouched', async () => {
      // A disk error is not a missing row, and must not be reported as one.
      await expect(
        repository.link(999, { kind: 'payout', id: 1 }, null),
      ).rejects.toMatchObject({ name: 'DocumentNotFoundError' });
    });
  });

  describe('full-text search', () => {
    beforeEach(async () => {
      await repository.insert(draft());
      await repository.insert(
        draft({
          filename: 'rise-withdrawal.png',
          storedPath: 'ef/gh/efgh.png',
          sha256: 'b'.repeat(64),
          docType: 'screenshot',
          extractedText: 'Rise payout confirmation',
        }),
      );
    });

    it('matches a word in the filename', async () => {
      const found = await repository.search('rise');

      expect(found.map((one) => one.filename)).toEqual(['rise-withdrawal.png']);
    });

    it('matches a word in the extracted text', async () => {
      const found = await repository.search('998877');

      expect(found.map((one) => one.filename)).toEqual(['coindcx-march.pdf']);
    });

    it('finds nothing for a word that is not there', async () => {
      await expect(repository.search('kraken')).resolves.toEqual([]);
    });

    it('returns nothing for a blank query rather than everything', async () => {
      await expect(repository.search('   ')).resolves.toEqual([]);
    });

    it('keeps the index in step when a document is updated', async () => {
      const [document] = await repository.search('998877');
      if (document === undefined) throw new Error('missing');

      await repository.update(document.withExtractedText('kraken ledger'));

      await expect(repository.search('998877')).resolves.toEqual([]);
      await expect(repository.search('kraken')).resolves.toHaveLength(1);
    });

    it('treats punctuation as text, not as query syntax', async () => {
      // A raw FTS5 query would read this as an operator and throw.
      await expect(repository.search('rise OR "')).resolves.toEqual([]);
    });
  });

  describe('toFtsPhrase', () => {
    it('wraps the query as one phrase', () => {
      expect(toFtsPhrase('march statement')).toBe('"march statement"');
    });

    it('escapes embedded quotes by doubling them', () => {
      expect(toFtsPhrase('say "hi"')).toBe('"say ""hi"""');
    });
  });
});
