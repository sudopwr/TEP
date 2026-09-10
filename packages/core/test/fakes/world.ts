import { currencies, USD } from '../../src/domain/currency';
import { FeeSchedule } from '../../src/domain/fee-schedule';
import { Money } from '../../src/domain/money';
import * as reference from '../../src/domain/reference-payout.fixture';

import { FakeAccountRepository } from './fake-account-repository';
import { FakeClock } from './fake-clock';
import { FakeCompanyRepository } from './fake-company-repository';
import { FakeDocumentRepository } from './fake-document-repository';
import { FakeDocumentStore } from './fake-document-store';
import { FakeFeeScheduleRepository } from './fake-fee-schedule-repository';
import { FakeIdGenerator } from './fake-id-generator';
import { FakePayoutRepository } from './fake-payout-repository';
import { FakeTransactionRepository } from './fake-transaction-repository';

/** The three schedules CLAUDE.md §8 declares. */
export const COINDCX_EXCHANGE_FEE = FeeSchedule.create({
  id: 1,
  accountId: 4,
  feeType: 'exchange_fee',
  basis: 'to_amount',
  rateBps: 50,
  flatAmount: null,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

export const COINDCX_GST = FeeSchedule.create({
  id: 2,
  accountId: 4,
  feeType: 'gst',
  basis: 'exchange_fee',
  rateBps: 1800,
  flatAmount: null,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

export const RISE_NETWORK_FEE = FeeSchedule.create({
  id: 3,
  accountId: 2,
  feeType: 'network_fee',
  basis: 'flat',
  rateBps: null,
  flatAmount: Money.fromDecimalString('4.00', USD),
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
});

/**
 * Every fake, wired together, with helpers to arrange the common shapes.
 *
 * A use-case test builds a world, seeds what it needs, and runs the real use
 * case against real (if in-memory) implementations. Nothing here is a mock:
 * there is no recording of calls and no stubbed return value, just a Map.
 */
export class TestWorld {
  readonly companies = new FakeCompanyRepository();
  readonly accounts = new FakeAccountRepository();
  readonly payouts = new FakePayoutRepository();
  readonly transactions = new FakeTransactionRepository();
  readonly documents = new FakeDocumentRepository();
  readonly feeSchedules = new FakeFeeScheduleRepository();
  readonly store = new FakeDocumentStore();
  readonly clock = new FakeClock();
  readonly ids = new FakeIdGenerator();
  readonly currencies = currencies;

  /** Companies and accounts only — an empty ledger to record into. */
  static withCounterparties(): TestWorld {
    const world = new TestWorld();

    world.companies.seed(reference.TRADEIFY, reference.RISE_CO);
    world.accounts.seed(
      reference.TRADEIFY_ACCOUNT,
      reference.RISE,
      reference.TRUSTWALLET,
      reference.COINDCX,
      reference.BANK,
    );

    return world;
  }

  /** The counterparties plus the §10 fee schedules. */
  static withFeeSchedules(): TestWorld {
    const world = TestWorld.withCounterparties();
    world.feeSchedules.seed(
      COINDCX_EXCHANGE_FEE,
      COINDCX_GST,
      RISE_NETWORK_FEE,
    );
    return world;
  }

  /** The whole verified TradeifyPayout001 tree, fees and all. */
  static withReferencePayout(): TestWorld {
    const world = TestWorld.withCounterparties();

    world.payouts.seed(reference.PAYOUT);
    world.transactions.seed(...reference.TRANSACTIONS);
    world.transactions.seedFees(...reference.FEES);

    return world;
  }
}

export { reference };
