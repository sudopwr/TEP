import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import type { Document, DocumentType } from '../domain/document';

import { DOCUMENTS_PER_PAGE, ListDocuments } from './list-documents';

interface Filed {
  readonly filename: string;
  readonly docDate: string | null;
  readonly docType?: DocumentType;
  readonly extractedText?: string;
}

/**
 * Fourteen documents: two pages and a bit, which is the only shape that shows
 * a paging bug. Dates deliberately out of insertion order — the register is
 * sorted by what a document is dated, not by the evening it was uploaded.
 */
const FILED: readonly Filed[] = [
  { filename: 'coindcx-january.pdf', docDate: '2024-01-31' },
  { filename: 'tradeify-agreement.pdf', docDate: '2023-11-02' },
  { filename: 'coindcx-march.pdf', docDate: '2024-03-31' },
  { filename: 'rise-withdrawal-1.png', docDate: '2024-03-04' },
  { filename: 'rise-withdrawal-2.png', docDate: '2024-03-05' },
  { filename: 'bank-credit-march.pdf', docDate: '2024-03-28' },
  { filename: 'coindcx-february.pdf', docDate: '2024-02-29' },
  { filename: 'tds-certificate.pdf', docDate: '2024-04-15' },
  { filename: 'rise-withdrawal-3.png', docDate: '2024-03-06' },
  { filename: 'bank-credit-april.pdf', docDate: '2024-04-02' },
  { filename: 'rise-withdrawal-4.png', docDate: '2024-03-07' },
  { filename: 'wallet-screenshot.png', docDate: '2024-03-08' },
  { filename: 'coindcx-april.pdf', docDate: '2024-04-30' },
  { filename: 'ledger-notes.txt', docDate: '2023-12-01' },
];

/**
 * Filed through the port, not seeded past it.
 *
 * `insert` is the one call both worlds share, so the same test runs against
 * the fake and against real SQLite — where the ordering is an `ORDER BY`, the
 * filename match a `LIKE`, and the text match an FTS5 index. None of that
 * would be exercised by a fake reached directly.
 */
const setup = async (filed: readonly Filed[] = FILED) => {
  const world = TestWorld.withCounterparties();

  for (const file of filed) {
    await world.documents.insert({
      filename: file.filename,
      storedPath: `ab/cd/${file.filename}`,
      mimeType: null,
      byteSize: 1024,
      sha256: null,
      docType: file.docType ?? null,
      docDate: file.docDate,
      extractedText: file.extractedText ?? null,
    });
  }

  return { world, list: new ListDocuments({ documents: world.documents }) };
};

const names = (documents: readonly Document[]): readonly string[] =>
  documents.map((document) => document.filename);

describe('ListDocuments', () => {
  it('answers the first page, newest first, without being asked', async () => {
    // No command at all: opening the screen is the commonest call there is.
    const { list } = await setup();

    const page = await list.execute();

    expect(page.documents).toHaveLength(DOCUMENTS_PER_PAGE);
    expect(page.total).toBe(14);
    expect(page.pages).toBe(2);
    expect(page.page).toBe(1);
    expect(names(page.documents).slice(0, 3)).toEqual([
      'coindcx-april.pdf',
      'tds-certificate.pdf',
      'bank-credit-april.pdf',
    ]);
  });

  it('carries on where the first page stopped, with nothing repeated', async () => {
    const { list } = await setup();

    const first = await list.execute({ page: 1 });
    const second = await list.execute({ page: 2 });

    expect(second.documents).toHaveLength(4);
    expect(second.page).toBe(2);
    const seen = new Set([
      ...names(first.documents),
      ...names(second.documents),
    ]);
    expect(seen.size).toBe(14);
  });

  it('narrows by filename, and counts the narrowed list', async () => {
    const { list } = await setup();

    const page = await list.execute({ search: 'coindcx' });

    expect(page.total).toBe(4);
    expect(page.pages).toBe(1);
    expect(names(page.documents)).toEqual([
      'coindcx-april.pdf',
      'coindcx-march.pdf',
      'coindcx-february.pdf',
      'coindcx-january.pdf',
    ]);
  });

  it('finds a fragment of a name, not only a whole word', async () => {
    // How a register is actually browsed: half a word and a glance.
    const { list } = await setup();

    await expect(list.execute({ search: 'withdraw' })).resolves.toHaveProperty(
      'total',
      4,
    );
  });

  it('searches the text inside a document too, as F7 promises', async () => {
    const { list } = await setup([
      {
        filename: 'statement.pdf',
        docDate: '2024-03-31',
        extractedText: 'TDS deducted 868.88',
      },
      { filename: 'agreement.pdf', docDate: '2023-11-02' },
    ]);

    const page = await list.execute({ search: '868.88' });

    expect(names(page.documents)).toEqual(['statement.pdf']);
  });

  it('answers everything to a blank search, where UC9 answers nothing', async () => {
    // The distinction that justifies a second use case: whitespace is not a
    // query, and a register with nothing typed in the box is still a register.
    const { list } = await setup();

    await expect(list.execute({ search: '   ' })).resolves.toHaveProperty(
      'total',
      14,
    );
  });

  it('is empty, not broken, when nothing matches', async () => {
    const { list } = await setup();

    const page = await list.execute({ search: 'kraken' });

    expect(page.documents).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.page).toBe(1);
    // One page of nothing, not zero pages: the control at the bottom has to
    // say something, and "page 1 of 0" is not it.
    expect(page.pages).toBe(1);
  });

  it('answers the last page when asked for one past the end', async () => {
    // The commonest way to fall off the end is to delete your way there, and
    // a table reading "showing 81–90 of 14" is lying about its own contents.
    const { list } = await setup();

    const page = await list.execute({ page: 9 });

    expect(page.page).toBe(2);
    expect(page.documents).toHaveLength(4);
  });

  it('treats a nonsense page as the first', async () => {
    const { list } = await setup();

    for (const page of [0, -3, 1.5, Number.NaN]) {
      await expect(list.execute({ page })).resolves.toHaveProperty('page', 1);
    }
  });

  it('honours a different page size, and refuses a download', async () => {
    const { list } = await setup();

    await expect(list.execute({ perPage: 5 })).resolves.toMatchObject({
      perPage: 5,
      pages: 3,
    });
    await expect(list.execute({ perPage: 10_000 })).resolves.toHaveProperty(
      'perPage',
      100,
    );
    await expect(list.execute({ perPage: 0 })).resolves.toHaveProperty(
      'perPage',
      DOCUMENTS_PER_PAGE,
    );
  });

  it("does not let a % in the box match everything", async () => {
    // `%` and `_` are SQL's own wildcards. A filename search for `50%` that
    // quietly returns the whole register is worse than one that finds nothing,
    // because it looks like it worked.
    const { list } = await setup([
      { filename: '50%-fill.pdf', docDate: '2024-03-31' },
      { filename: 'coindcx-march.pdf', docDate: '2024-03-30' },
      { filename: 'rise_fee.png', docDate: '2024-03-29' },
    ]);

    await expect(list.execute({ search: '50%' })).resolves.toMatchObject({
      total: 1,
    });
    await expect(list.execute({ search: '_' })).resolves.toMatchObject({
      total: 1,
    });
  });

  it('sorts a document nobody dated as just arrived', async () => {
    // `doc_date` is optional, and a pasted screenshot rarely has one. It
    // belongs where the user just put it, not at the bottom of the register.
    const { list } = await setup([
      { filename: 'old-agreement.pdf', docDate: '2023-11-02' },
      { filename: 'pasted-screenshot.png', docDate: null },
      { filename: 'march-statement.pdf', docDate: '2024-03-31' },
    ]);

    const page = await list.execute();

    expect(names(page.documents)[0]).toBe('pasted-screenshot.png');
  });
});
