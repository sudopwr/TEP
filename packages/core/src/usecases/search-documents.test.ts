import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';

import { AttachDocument } from './attach-document';
import { SearchDocuments } from './search-documents';

const setup = async () => {
  const world = TestWorld.withReferencePayout();
  const attach = new AttachDocument({
    documents: world.documents,
    store: world.store,
  });

  await attach.execute({
    bytes: Uint8Array.from([1]),
    filename: 'coindcx-march.pdf',
    target: { kind: 'payout', id: 1 },
    extractedText: 'CoinDCX Statement March 2025 order 998877',
  });
  await attach.execute({
    bytes: Uint8Array.from([2]),
    filename: 'rise-withdrawal.png',
    target: { kind: 'transaction', id: 2 },
    extractedText: 'Rise payout confirmation',
  });

  return {
    world,
    useCase: new SearchDocuments({ documents: world.documents }),
  };
};

describe('SearchDocuments (UC9)', () => {
  it('matches on filename', async () => {
    const { useCase } = await setup();

    const found = await useCase.execute({ query: 'rise' });

    expect(found.map((document) => document.filename)).toEqual([
      'rise-withdrawal.png',
    ]);
  });

  it('matches on extracted text', async () => {
    const { useCase } = await setup();

    const found = await useCase.execute({ query: '998877' });

    expect(found.map((document) => document.filename)).toEqual([
      'coindcx-march.pdf',
    ]);
  });

  it('returns nothing for a query that matches nothing', async () => {
    const { useCase } = await setup();

    expect(await useCase.execute({ query: 'kraken' })).toEqual([]);
  });

  it('returns nothing for an empty query rather than everything', async () => {
    const { useCase } = await setup();

    expect(await useCase.execute({ query: '   ' })).toEqual([]);
  });
});
