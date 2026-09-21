import { INR, Money, USD } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  arrangeCounterparties,
  arrangeReferencePayout,
  reference,
} from '../../test/arrange';
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
    traderId: 1,
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

describe('SqlitePayoutRepository.delete', () => {
  let database: SqliteDatabase;
  let repository: SqlitePayoutRepository;

  beforeEach(() => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;
    repository = new SqlitePayoutRepository(database, arranged.currencies);
  });

  afterEach(() => {
    database.close();
  });

  // `Number`, because the connection runs with SQLite's 64-bit integers on
  // (§6: a paisa past 2^53 has to survive), so even a COUNT arrives as a bigint.
  const count = (sql: string, ...params: unknown[]): number =>
    Number((database.prepare(sql).get(...params) as { c: number | bigint }).c);

  it('removes a tree four levels deep, which a plain cascade cannot', async () => {
    // The regression this exists for: `transactions.parent_id` is ON DELETE
    // RESTRICT, and RESTRICT is checked the instant a row goes rather than at
    // the end of the statement. So `DELETE FROM payouts` — whose CASCADE
    // reaches the legs in whatever order SQLite likes — fails outright on
    // §10's thirteen-leg tree. Proven directly below.
    expect(() => {
      database
        .prepare('DELETE FROM payouts WHERE id = ?')
        .run(reference.PAYOUT.id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    await repository.delete(reference.PAYOUT.id);

    expect(count('SELECT COUNT(*) c FROM payouts')).toBe(0);
    expect(count('SELECT COUNT(*) c FROM transactions')).toBe(0);
  });

  it('takes the fees on those legs with it', async () => {
    await repository.delete(reference.PAYOUT.id);

    expect(count('SELECT COUNT(*) c FROM transaction_fees')).toBe(0);
  });

  it('unlinks documents without deleting them', async () => {
    // F6: one document may be evidence for several things. Deleting the
    // payout a statement was uploaded from must not take it away from the
    // company it is also attached to.
    const document = database
      .prepare(
        `INSERT INTO documents (filename, stored_path, sha256)
         VALUES ('statement.pdf', 'ab/cd/statement.pdf', 'abc123')
         RETURNING id`,
      )
      .get() as { id: number };

    database
      .prepare(
        'INSERT INTO document_links (document_id, payout_id) VALUES (?, ?)',
      )
      .run(document.id, reference.PAYOUT.id);
    database
      .prepare(
        'INSERT INTO document_links (document_id, company_id) VALUES (?, ?)',
      )
      .run(document.id, reference.TRADEIFY.id);

    await repository.delete(reference.PAYOUT.id);

    expect(count('SELECT COUNT(*) c FROM documents')).toBe(1);
    expect(
      count(
        'SELECT COUNT(*) c FROM document_links WHERE company_id IS NOT NULL',
      ),
    ).toBe(1);
    expect(
      count(
        'SELECT COUNT(*) c FROM document_links WHERE payout_id IS NOT NULL',
      ),
    ).toBe(0);
  });

  it('leaves the company and the accounts standing', async () => {
    await repository.delete(reference.PAYOUT.id);

    expect(count('SELECT COUNT(*) c FROM companies')).toBe(2);
    expect(count('SELECT COUNT(*) c FROM accounts')).toBe(5);
  });

  it('leaves another payout and its legs untouched', async () => {
    const other = await repository.insert({
      code: 'TradeifyPayout002',
      companyId: reference.TRADEIFY.id,
      traderId: reference.DEFAULT_TRADER.id,
      payoutDate: '2025-05-01',
      reference: null,
      gross: Money.fromDecimalString('500.00', USD),
      charges: Money.zero(USD),
      notes: null,
    });

    await repository.delete(reference.PAYOUT.id);

    await expect(repository.findById(other.id)).resolves.not.toBeNull();
  });

  it('is a no-op for an id that is not there', async () => {
    await expect(repository.delete(4242)).resolves.toBeUndefined();

    expect(count('SELECT COUNT(*) c FROM payouts')).toBe(1);
    expect(count('SELECT COUNT(*) c FROM transactions')).toBe(
      reference.TRANSACTIONS.length,
    );
  });
});
