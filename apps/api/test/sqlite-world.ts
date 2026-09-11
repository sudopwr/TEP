import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  Account,
  Company,
  CurrencyRegistry,
  FeeSchedule,
  IsoDate,
  Payout,
  Transaction,
  TransactionFee,
} from '@payout/core';
import * as reference from '@core/domain/reference-payout.fixture';

import { loadCurrencyRegistry } from '../src/adapters/currency-registry';
import { FileSystemDocumentStore } from '../src/adapters/filesystem-document-store';
import { bulkLoad, countRows, snapshot } from '../src/adapters/maintenance';
import { SqliteAccountRepository } from '../src/adapters/sqlite-account-repository';
import { SqliteCompanyRepository } from '../src/adapters/sqlite-company-repository';
import { SqliteDocumentRepository } from '../src/adapters/sqlite-document-repository';
import { SqliteFeeScheduleRepository } from '../src/adapters/sqlite-fee-schedule-repository';
import { SqlitePayoutRepository } from '../src/adapters/sqlite-payout-repository';
import { SqliteTransactionRepository } from '../src/adapters/sqlite-transaction-repository';
import type { SqliteDatabase } from '../src/db/connection';

import { openTestDatabase } from './open-test-database';

/**
 * The same world the use-case tests already know, with SQLite underneath.
 *
 * Stage 5 wrote those tests against in-memory fakes. This module presents an
 * identical surface — the same class name, the same factories, the same
 * test-only affordances — backed by the real repositories, the real schema
 * and the real file store. The vitest `sqlite` project swaps this module in
 * for the fakes without the test files changing by a character, which is the
 * only way to find out whether the ports were describing something real.
 *
 * The clock stays controllable. Swapping in a real clock would test that time
 * passes, not that the adapters work.
 */

const STORE_ROOT = mkdtempSync(path.join(tmpdir(), 'payout-tracker-store-'));

/** A clock a test can pin, matching the fake world's FakeClock surface. */
export class ControllableClock {
  #instant: Date;

  constructor(iso = '2025-03-16T10:30:00.000Z') {
    this.#instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }

  today(): IsoDate {
    return this.#instant.toISOString().slice(0, 10);
  }

  set(iso: string): void {
    this.#instant = new Date(iso);
  }

  advanceSeconds(seconds: number): void {
    this.#instant = new Date(this.#instant.getTime() + seconds * 1000);
  }
}

class SeededCompanyRepository extends SqliteCompanyRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    super(database);
    this.#database = database;
  }

  seed(...companies: readonly Company[]): this {
    bulkLoad(this.#database, { companies });
    return this;
  }

  size(): number {
    return countRows(this.#database, 'companies');
  }
}

class SeededAccountRepository extends SqliteAccountRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    super(database);
    this.#database = database;
  }

  seed(...accounts: readonly Account[]): this {
    bulkLoad(this.#database, { accounts });
    return this;
  }

  size(): number {
    return countRows(this.#database, 'accounts');
  }
}

class SeededPayoutRepository extends SqlitePayoutRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    super(database, currencies);
    this.#database = database;
  }

  seed(...payouts: readonly Payout[]): this {
    bulkLoad(this.#database, { payouts });
    return this;
  }

  size(): number {
    return countRows(this.#database, 'payouts');
  }
}

class SeededTransactionRepository extends SqliteTransactionRepository {
  readonly #database: SqliteDatabase;
  readonly #currencies: CurrencyRegistry;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    super(database, currencies);
    this.#database = database;
    this.#currencies = currencies;
  }

  seed(...transactions: readonly Transaction[]): this {
    bulkLoad(this.#database, { transactions });
    return this;
  }

  seedFees(...fees: readonly TransactionFee[]): this {
    bulkLoad(this.#database, { fees });
    return this;
  }

  all(): readonly Transaction[] {
    return snapshot(this.#database, this.#currencies).transactions;
  }

  allFees(): readonly TransactionFee[] {
    return snapshot(this.#database, this.#currencies).fees;
  }
}

class SeededDocumentRepository extends SqliteDocumentRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    super(database);
    this.#database = database;
  }

  documentCount(): number {
    return countRows(this.#database, 'documents');
  }

  linkCount(): number {
    return countRows(this.#database, 'document_links');
  }
}

class SeededFeeScheduleRepository extends SqliteFeeScheduleRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    super(database, currencies);
    this.#database = database;
  }

  seed(...feeSchedules: readonly FeeSchedule[]): this {
    bulkLoad(this.#database, { feeSchedules });
    return this;
  }
}

/** The real file store, rooted in a throwaway directory. */
class CountingDocumentStore extends FileSystemDocumentStore {
  readonly #root: string;

  constructor(root: string) {
    super(root);
    this.#root = root;
  }

  size(): number {
    return readdirSync(this.#root, {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile()).length;
  }
}

let worldCounter = 0;

export class TestWorld {
  readonly database: SqliteDatabase;
  readonly currencies: CurrencyRegistry;
  readonly companies: SeededCompanyRepository;
  readonly accounts: SeededAccountRepository;
  readonly payouts: SeededPayoutRepository;
  readonly transactions: SeededTransactionRepository;
  readonly documents: SeededDocumentRepository;
  readonly feeSchedules: SeededFeeScheduleRepository;
  readonly store: CountingDocumentStore;
  readonly clock = new ControllableClock();

  constructor() {
    this.database = openTestDatabase();
    // Scales come from the currencies table, not from a hard-coded registry.
    this.currencies = loadCurrencyRegistry(this.database);

    this.companies = new SeededCompanyRepository(this.database);
    this.accounts = new SeededAccountRepository(this.database);
    this.payouts = new SeededPayoutRepository(this.database, this.currencies);
    this.transactions = new SeededTransactionRepository(
      this.database,
      this.currencies,
    );
    this.documents = new SeededDocumentRepository(this.database);
    this.feeSchedules = new SeededFeeScheduleRepository(
      this.database,
      this.currencies,
    );

    worldCounter += 1;
    this.store = new CountingDocumentStore(
      path.join(STORE_ROOT, String(worldCounter)),
    );
  }

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

  static withFeeSchedules(): TestWorld {
    const world = TestWorld.withCounterparties();
    world.feeSchedules.seed(...reference.FEE_SCHEDULES);
    return world;
  }

  static withReferencePayout(): TestWorld {
    const world = TestWorld.withCounterparties();

    world.payouts.seed(reference.PAYOUT);
    world.transactions.seed(...reference.TRANSACTIONS);
    world.transactions.seedFees(...reference.FEES);

    return world;
  }
}

export const { COINDCX_EXCHANGE_FEE, COINDCX_GST, RISE_NETWORK_FEE } =
  reference;

export { reference };
