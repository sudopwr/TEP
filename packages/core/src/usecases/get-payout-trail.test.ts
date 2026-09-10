import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import { PayoutNotFoundError } from '../domain/errors';

import { AttachDocument } from './attach-document';
import { GetPayoutTrail, type TrailNode } from './get-payout-trail';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new GetPayoutTrail({
    payouts: world.payouts,
    transactions: world.transactions,
    documents: world.documents,
  });
  return { world, useCase };
};

const depthOf = (node: TrailNode): number =>
  node.children.length === 0 ? 1 : 1 + Math.max(...node.children.map(depthOf));

const flatten = (nodes: readonly TrailNode[]): readonly TrailNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('GetPayoutTrail (UC5)', () => {
  it('returns the payout it was asked for', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });

    expect(trail.payout.code).toBe('TradeifyPayout001');
  });

  it('nests the tree rather than returning a flat list', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });

    // One root credit, four withdrawals under it, a transfer under each of
    // those, and a sale under each transfer. Four levels, not thirteen rows.
    expect(trail.roots).toHaveLength(1);
    expect(trail.roots[0]?.transaction.code).toBe('Transaction001');
    expect(trail.roots[0]?.children).toHaveLength(4);
    expect(depthOf(trail.roots[0] as TrailNode)).toBe(4);
  });

  it('holds every leg exactly once across the tree', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });
    const codes = flatten(trail.roots).map((node) => node.transaction.code);

    expect(codes).toHaveLength(13);
    expect(new Set(codes).size).toBe(13);
  });

  it('puts each sale under its own transfer', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });
    const withdrawalA = trail.roots[0]?.children[0];
    const transferA = withdrawalA?.children[0];

    expect(withdrawalA?.transaction.code).toBe('Transaction002');
    expect(transferA?.transaction.code).toBe('Transaction007');
    expect(transferA?.children[0]?.transaction.code).toBe('Transaction003');
    expect(transferA?.children[0]?.children).toEqual([]);
  });

  it('hangs each leg’s fees on its own node', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });
    const bySale = flatten(trail.roots).find(
      (node) => node.transaction.code === 'Transaction003',
    );

    expect(bySale?.fees.map((fee) => fee.feeType).sort()).toEqual([
      'exchange_fee',
      'gst',
      'tds',
    ]);
  });

  it('leaves fee-free legs with an empty fee list', async () => {
    const { useCase } = setup();

    const trail = await useCase.execute({ payoutId: 1 });

    expect(trail.roots[0]?.fees).toEqual([]);
  });

  it('hangs documents on the leg they were attached to', async () => {
    const { world, useCase } = setup();
    await new AttachDocument({
      documents: world.documents,
      store: world.store,
    }).execute({
      bytes: Uint8Array.from([1, 2, 3]),
      filename: 'sale-003.png',
      target: { kind: 'transaction', id: 3 },
    });

    const trail = await useCase.execute({ payoutId: 1 });
    const sale = flatten(trail.roots).find(
      (node) => node.transaction.code === 'Transaction003',
    );

    expect(sale?.documents.map((document) => document.filename)).toEqual([
      'sale-003.png',
    ]);
    expect(trail.roots[0]?.documents).toEqual([]);
  });

  it('treats a leg whose parent is outside the payout as a root', async () => {
    const { world, useCase } = setup();
    await world.transactions.insert({
      code: 'Transaction200',
      payoutId: 1,
      parentId: 9999,
      txnDate: '2025-03-21',
      kind: 'deposit',
      fromAccountId: 4,
      toAccountId: 5,
      fromAmount: reference.SALE_003.fromAmount,
      toAmount: reference.SALE_003.toAmount,
      rate: null,
    });

    const trail = await useCase.execute({ payoutId: 1 });

    // An orphan surfaces instead of disappearing from the tree.
    expect(trail.roots).toHaveLength(2);
    expect(trail.roots.map((node) => node.transaction.code).sort()).toEqual([
      'Transaction001',
      'Transaction200',
    ]);
  });

  it('returns an empty trail for a payout with no legs', async () => {
    const { world, useCase } = setup();
    const empty = await world.payouts.insert({
      code: 'TradeifyPayout009',
      companyId: 1,
      payoutDate: '2025-05-01',
      reference: null,
      gross: reference.PAYOUT.gross,
      charges: reference.PAYOUT.charges,
      notes: null,
    });

    const trail = await useCase.execute({ payoutId: empty.id });

    expect(trail.roots).toEqual([]);
  });

  it('rejects an unknown payout', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ payoutId: 99 })).rejects.toThrow(
      PayoutNotFoundError,
    );
  });
});
