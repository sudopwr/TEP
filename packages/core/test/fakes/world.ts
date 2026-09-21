import { currencies } from '../../src/domain/currency';
import * as reference from '../../src/domain/reference-payout.fixture';
import { User } from '../../src/domain/user';

import { FakeAccountRepository } from './fake-account-repository';
import { FakeClock } from './fake-clock';
import { FakeCompanyRepository } from './fake-company-repository';
import { FakeDocumentRepository } from './fake-document-repository';
import { FakeDocumentStore } from './fake-document-store';
import { FakeFeeScheduleRepository } from './fake-fee-schedule-repository';
import { FakeIdGenerator } from './fake-id-generator';
import { FakePasswordHasher } from './fake-password-hasher';
import { FakePayoutRepository } from './fake-payout-repository';
import { FakeSessionRepository } from './fake-session-repository';
import { FakeTraderRepository } from './fake-trader-repository';
import { FakeTransactionRepository } from './fake-transaction-repository';
import { FakeUserRepository } from './fake-user-repository';

/**
 * Every fake, wired together, with helpers to arrange the common shapes.
 *
 * A use-case test builds a world, seeds what it needs, and runs the real use
 * case against real (if in-memory) implementations. Nothing here is a mock:
 * there is no recording of calls and no stubbed return value, just a Map.
 */
export class TestWorld {
  readonly traders = new FakeTraderRepository();
  readonly companies = new FakeCompanyRepository();
  readonly accounts = new FakeAccountRepository();
  readonly payouts = new FakePayoutRepository();
  readonly transactions = new FakeTransactionRepository();
  readonly documents = new FakeDocumentRepository();
  readonly feeSchedules = new FakeFeeScheduleRepository();
  readonly store = new FakeDocumentStore();
  readonly users = new FakeUserRepository();
  readonly sessions = new FakeSessionRepository();
  readonly hasher = new FakePasswordHasher();
  readonly clock = new FakeClock();
  readonly ids = new FakeIdGenerator();
  readonly currencies = currencies;

  /**
   * Every world ships the default admin, because every database does.
   *
   * Migration 003 seeds `admin` / `admin` with the must-change flag into any
   * SQLite database the moment it is created, so a fake world without it
   * would be a world the contract run could not reproduce.
   */
  constructor() {
    // A payout takes its legs with it, here as in SQLite (`001_initial.sql`
    // cascades; the adapter orders it leaf-first). Wired once, so no test has
    // to remember that the two fakes are two halves of one delete.
    this.payouts.cascadeTo(this.transactions);

    this.users.seed(
      User.create({
        id: DEFAULT_ADMIN_ID,
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: FakePasswordHasher.encode(DEFAULT_ADMIN_PASSWORD),
        mustChangePassword: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        passwordChangedAt: null,
      }),
    );
  }

  /** Companies and accounts only — an empty ledger to record into. */
  static withCounterparties(): TestWorld {
    const world = new TestWorld();

    // The trader `004_traders.sql` creates, so a fake world and a migrated
    // database agree about whose payouts §10's are.
    world.traders.seed(reference.DEFAULT_TRADER);
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
    world.feeSchedules.seed(...reference.FEE_SCHEDULES);
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

/**
 * The shipped default (CLAUDE.md §5a), named rather than spelled out.
 *
 * Both worlds agree on these three values; only the hash differs, which is
 * exactly the thing a test must never assert on.
 */
export const DEFAULT_ADMIN_ID = 1;
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin';

export const { COINDCX_EXCHANGE_FEE, COINDCX_GST, RISE_NETWORK_FEE } =
  reference;

export { reference };
