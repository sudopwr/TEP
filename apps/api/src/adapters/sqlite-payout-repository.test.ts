import { INR, Money, USD } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arrangeCounterparties } from '../../test/arrange';
import type { SqliteDatabase } from '../db/connection';

import { SqlitePayoutRepository } from './sqlite-payout-repository';

describe('SqlitePayoutRepository', () => {
  let database: SqliteDatabase;
  let repository: SqlitePayoutRepository;

  beforeEach(() => {
    const arranged = arrangeCounterparties();
    database = arranged.database;
    repository = new SqlitePayoutRepository(database, arranged.currencies);
  });

  afterEach(() => {
    database.close();
  });

  const draft = (overrides: Record<string, unknown> = {}) => ({
    code: 'TradeifyPayout001',
    companyId: 1,
    payoutDate: '2025-03-10',
    reference: 'FTDFYSLX50676373980',
    gross: Money.fromDecimalString('1008.01', USD),
    charges: Money.fromDecimalString('100.79', USD),
    notes: null,
    ...overrides,
  });

  it('round-trips gross and charges exactly', async () => {
    const payout = await repository.insert(draft());

    expect(payout.gross.toDecimalString()).toBe('1008.01');
    expect(payout.charges.toDecimalString()).toBe('100.79');
    expect(payout.gross.currency.code).toBe('USD');
    await expect(repository.findById(payout.id)).resolves.toEqual(payout);
  });

  it('round-trips an amount far beyond float64 exactness', async () => {
    // 90,071,992,547,409.93 rupees — one paisa past 2^53 minor units.
    const huge = Money.fromMinor(9007199254740993n, INR);
    const payout = await repository.insert(
      draft({ gross: huge, charges: Money.zero(INR) }),
    );

    expect(payout.gross.minor).toBe(9007199254740993n);
  });

  it('finds by code and returns null when there is none', async () => {
    await repository.insert(draft());

    await expect(
      repository.findByCode('TradeifyPayout001'),
    ).resolves.not.toBeNull();
    await expect(repository.findByCode('nope')).resolves.toBeNull();
  });

  it('filters by company', async () => {
    await repository.insert(draft());
    await repository.insert(draft({ code: 'RisePayout001', companyId: 2 }));

    const tradeify = await repository.listByCompany(1);

    expect(tradeify.map((one) => one.code)).toEqual(['TradeifyPayout001']);
  });

  it('filters by date range, inclusive at both ends', async () => {
    await repository.insert(draft({ code: 'P1', payoutDate: '2025-03-31' }));
    await repository.insert(draft({ code: 'P2', payoutDate: '2025-04-01' }));
    await repository.insert(draft({ code: 'P3', payoutDate: '2026-03-31' }));

    const financialYear = await repository.listByDateRange({
      from: '2025-04-01',
      to: '2026-03-31',
    });

    expect(financialYear.map((one) => one.code)).toEqual(['P2', 'P3']);
  });

  it('persists an update', async () => {
    const payout = await repository.insert(draft());

    const updated = await repository.update(payout.withReference('NEW-REF'));

    expect(updated.reference).toBe('NEW-REF');
    await expect(repository.findById(payout.id)).resolves.toEqual(updated);
  });

  it('refuses a payout whose company does not exist', async () => {
    await expect(
      repository.insert(draft({ companyId: 99 })),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  });

  it('refuses gross and charges in different currencies', async () => {
    // The schema has one currency_code column for both. Writing anyway would
    // silently relabel the charge.
    await expect(
      repository.insert(
        draft({ charges: Money.fromDecimalString('1.00', INR) }),
      ),
    ).rejects.toThrow(/one currency for both/);
  });

  it('does not read the stored status column', async () => {
    const payout = await repository.insert(draft());
    database
      .prepare("UPDATE payouts SET status = 'cancelled' WHERE id = ?")
      .run(payout.id);

    // §13: status is derived from the legs, so a stored value is ignored
    // rather than believed. Payout has no status property to compare.
    const reread = await repository.findById(payout.id);

    expect(reread).toEqual(payout);
    // The only status a Payout has is the one it computes from its legs.
    expect(typeof reread?.status).toBe('function');
  });
});
