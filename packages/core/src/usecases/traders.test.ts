import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import { TraderCodeTakenError } from '../domain/errors';
import { Money } from '../domain/money';
import { USD } from '../domain/currency';

import { GetAccountBalances } from './get-account-balances';
import { ListPayouts } from './list-payouts';
import { ListTraders } from './list-traders';
import { RecordPayout } from './record-payout';
import { RecordTrader } from './record-trader';
import { RunDataQualityChecks } from './run-data-quality-checks';

/**
 * F24 — more than one person's payouts in one ledger.
 *
 * The §10 tree belongs to the trader `004_traders.sql` creates. These tests
 * put a second person's payout beside it and then check the thing that
 * matters: that every screen answers about the same person.
 */
const setup = async () => {
  const world = TestWorld.withReferencePayout();

  const recordTrader = new RecordTrader({ traders: world.traders });
  const recordPayout = new RecordPayout({
    payouts: world.payouts,
    companies: world.companies,
    traders: world.traders,
    currencies: world.currencies,
    clock: world.clock,
  });

  const priya = await recordTrader.execute({ code: 'priya', name: 'Priya' });

  // Priya's own award, in a different month from §10's March tree.
  const hers = await recordPayout.execute({
    code: 'TradeifyPayout900',
    companyId: reference.TRADEIFY.id,
    traderId: priya.id,
    payoutDate: '2025-06-04',
    grossAmount: '500.00',
    currencyCode: 'USD',
  });

  return { world, priya, hers, recordPayout };
};

describe('RecordTrader', () => {
  it('records a person and gives them an id', async () => {
    const { world } = await setup();
    const useCase = new RecordTrader({ traders: world.traders });

    const trader = await useCase.execute({ code: 'sam', name: 'Sam' });

    expect(trader.id).toBeGreaterThan(0);
    expect(trader.name).toBe('Sam');
    await expect(world.traders.findById(trader.id)).resolves.toEqual(trader);
  });

  it('refuses a code that is already somebody', async () => {
    const { world } = await setup();
    const useCase = new RecordTrader({ traders: world.traders });

    await expect(
      useCase.execute({ code: 'priya', name: 'Priya Again' }),
    ).rejects.toBeInstanceOf(TraderCodeTakenError);
  });

  it('gives them no credential, because a trader is not a user (§5a)', async () => {
    // The distinction the whole feature rests on: adding a name to a dropdown
    // must not add a way to sign in.
    const { world } = await setup();

    await expect(world.users.count()).resolves.toBe(1);
    await expect(world.users.findByUsername('priya')).resolves.toBeNull();
  });
});

describe('ListTraders', () => {
  it('lists everybody the ledger keeps payouts for', async () => {
    const { world } = await setup();

    const traders = await new ListTraders({ traders: world.traders }).execute();

    expect(traders.map((one) => one.code)).toEqual(['default', 'priya']);
  });
});

describe('the shared scope', () => {
  it('lists one trader’s payouts, not everybody’s', async () => {
    const { world, priya } = await setup();
    const list = new ListPayouts({ payouts: world.payouts });

    await expect(list.execute()).resolves.toHaveLength(2);
    await expect(list.execute({ traderId: priya.id })).resolves.toHaveLength(1);
    await expect(
      list.execute({ traderId: reference.DEFAULT_TRADER.id }),
    ).resolves.toHaveLength(1);
  });

  it('narrows to a month, and to a month of one trader', async () => {
    const { world, priya } = await setup();
    const list = new ListPayouts({ payouts: world.payouts });
    const june = { from: '2025-06-01', to: '2025-06-30' };

    await expect(list.execute({ range: june })).resolves.toHaveLength(1);
    await expect(
      list.execute({ traderId: priya.id, range: june }),
    ).resolves.toHaveLength(1);
    await expect(
      list.execute({ traderId: reference.DEFAULT_TRADER.id, range: june }),
    ).resolves.toEqual([]);
  });

  it('keeps the company filter working alongside it', async () => {
    const { world, priya } = await setup();
    const list = new ListPayouts({ payouts: world.payouts });

    await expect(
      list.execute({ traderId: priya.id, companyId: reference.RISE_CO.id }),
    ).resolves.toEqual([]);
    await expect(
      list.execute({ traderId: priya.id, companyId: reference.TRADEIFY.id }),
    ).resolves.toHaveLength(1);
  });

  it('scopes the balances to whose money it is', async () => {
    // §10's balances come from the reference tree, which is the default
    // trader's. Priya has a payout and no movements, so hers are empty —
    // and a balances screen that ignored the scope would show the other
    // person's ₹84,642.93 under her name.
    const { world, priya } = await setup();
    const balances = new GetAccountBalances({
      accounts: world.accounts,
      transactions: world.transactions,
      payouts: world.payouts,
    });

    const everybody = await balances.execute();
    const hers = await balances.execute({ scope: { traderId: priya.id } });
    const theirs = await balances.execute({
      scope: { traderId: reference.DEFAULT_TRADER.id },
    });

    expect(everybody.length).toBeGreaterThan(0);
    expect(hers).toEqual([]);
    expect(theirs).toEqual(everybody);
  });

  it('scopes the checks, so a flag belongs to the period on screen', async () => {
    const { world, priya } = await setup();
    const checks = new RunDataQualityChecks({
      payouts: world.payouts,
      transactions: world.transactions,
      accounts: world.accounts,
      feeSchedules: world.feeSchedules,
    });

    const everybody = await checks.execute();
    const hers = await checks.execute({ scope: { traderId: priya.id } });

    // §7's dust row is in the reference tree, so it is not hers.
    expect(everybody.some((issue) => issue.check === 'exceeds_parent')).toBe(
      true,
    );
    expect(hers.some((issue) => issue.check === 'exceeds_parent')).toBe(false);
  });

  it('flags her payout as having no bank leg, which is her own problem', async () => {
    const { world, priya } = await setup();
    const checks = new RunDataQualityChecks({
      payouts: world.payouts,
      transactions: world.transactions,
      accounts: world.accounts,
      feeSchedules: world.feeSchedules,
    });

    const hers = await checks.execute({ scope: { traderId: priya.id } });

    expect(hers.map((issue) => issue.check)).toEqual(['no_bank_leg']);
  });

  it('refuses a payout for a trader who does not exist', async () => {
    const { world } = await setup();
    const record = new RecordPayout({
      payouts: world.payouts,
      companies: world.companies,
      traders: world.traders,
      currencies: world.currencies,
      clock: world.clock,
    });

    await expect(
      record.execute({
        code: 'Orphan',
        companyId: reference.TRADEIFY.id,
        traderId: 4242,
        grossAmount: '10.00',
        currencyCode: 'USD',
      }),
    ).rejects.toMatchObject({ name: 'TraderNotFoundError' });
  });

  it('keeps two traders’ money apart even in the same month', async () => {
    const { world, priya, recordPayout } = await setup();
    await recordPayout.execute({
      code: 'TradeifyPayout901',
      companyId: reference.TRADEIFY.id,
      traderId: reference.DEFAULT_TRADER.id,
      payoutDate: '2025-06-11',
      grossAmount: '250.00',
      currencyCode: 'USD',
    });

    const list = new ListPayouts({ payouts: world.payouts });
    const june = { from: '2025-06-01', to: '2025-06-30' };

    const hers = await list.execute({ traderId: priya.id, range: june });
    const theirs = await list.execute({
      traderId: reference.DEFAULT_TRADER.id,
      range: june,
    });

    expect(hers.map((one) => one.code)).toEqual(['TradeifyPayout900']);
    expect(theirs.map((one) => one.code)).toEqual(['TradeifyPayout901']);
    expect(theirs[0]?.gross).toEqual(Money.fromDecimalString('250.00', USD));
  });
});
