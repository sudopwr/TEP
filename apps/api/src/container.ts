import path from 'node:path';

import {
  AttachDocument,
  AuthenticateSession,
  ChangeCredentials,
  DeletePayout,
  GenerateFinancialYearReport,
  GetAccountBalances,
  GetDocument,
  GetPayoutTrail,
  GetSettlement,
  ImportLegacyCsv,
  ListAccounts,
  ListCompanies,
  ListPayouts,
  ListTransactions,
  RecordAccount,
  RecordCompany,
  RecordPayout,
  RecordSale,
  RecordTransaction,
  RunDataQualityChecks,
  SearchDocuments,
  SignIn,
  SignOut,
  type Clock,
  type IdGenerator,
} from '@payout/core';

import { CryptoIdGenerator } from './adapters/crypto-id-generator';
import { loadCurrencyRegistry } from './adapters/currency-registry';
import { FileCsvReader } from './adapters/file-csv-reader';
import { FileSystemDocumentStore } from './adapters/filesystem-document-store';
import { SqliteAccountRepository } from './adapters/sqlite-account-repository';
import { SqliteCompanyRepository } from './adapters/sqlite-company-repository';
import { SqliteDocumentRepository } from './adapters/sqlite-document-repository';
import { SqliteFeeScheduleRepository } from './adapters/sqlite-fee-schedule-repository';
import { SqlitePayoutRepository } from './adapters/sqlite-payout-repository';
import { SqliteSessionRepository } from './adapters/sqlite-session-repository';
import { SqliteTransactionRepository } from './adapters/sqlite-transaction-repository';
import { SqliteUserRepository } from './adapters/sqlite-user-repository';
import { SystemClock } from './adapters/system-clock';
import { Argon2PasswordHasher } from './auth/argon2-password-hasher';
import type { SqliteDatabase } from './db/connection';
import type { DocumentFileSource, UseCases } from './decorators';

/**
 * The only file that imports both a use case and an adapter (CLAUDE.md §5).
 *
 * That is the whole job. Every dependency in the application is constructed
 * here and injected downward: a use case receives ports, a route receives use
 * cases off the Fastify instance, and nothing in either direction learns what
 * the other is made of. Grep for `Sqlite` outside `adapters/` and this file,
 * and the only hits should be tests wiring their own world.
 */
export interface Container {
  readonly useCases: UseCases;
  readonly documentFiles: DocumentFileSource;
  /** Kept for the bootstrap, which reads the must-change flag before listen. */
  readonly users: SqliteUserRepository;
  readonly hasher: Argon2PasswordHasher;
  /**
   * F12, wired here rather than in the CLI.
   *
   * It is not on `UseCases` because no route may reach it — importing the
   * legacy sheet is a one-off, not part of the running application. It is
   * built here anyway so that `cli/import.ts` does not become a second place
   * that knows how to assemble an adapter, which is exactly the thing §5's
   * rule is for. `container.test.ts` fails if that ever happens again.
   */
  readonly importLegacyCsv: ImportLegacyCsv;
}

export interface ContainerOptions {
  /** Where `data/files` lives. N6: back up by copying that folder. */
  readonly filesRoot?: string;
  /** Overridable so a test can expire a session without waiting a month. */
  readonly sessionLifetimeMs?: number;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export function buildContainer(
  database: SqliteDatabase,
  options: ContainerOptions = {},
): Container {
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new CryptoIdGenerator();
  const hasher = new Argon2PasswordHasher();

  // Scales come from the `currencies` table, not from a hard-coded registry:
  // §6 says the scale lives in the database, and the domain reads it.
  const currencies = loadCurrencyRegistry(database);

  const companies = new SqliteCompanyRepository(database);
  const accounts = new SqliteAccountRepository(database);
  const payouts = new SqlitePayoutRepository(database, currencies);
  const transactions = new SqliteTransactionRepository(database, currencies);
  const documents = new SqliteDocumentRepository(database);
  const feeSchedules = new SqliteFeeScheduleRepository(database, currencies);
  const users = new SqliteUserRepository(database);
  const sessions = new SqliteSessionRepository(database);

  const store = new FileSystemDocumentStore(
    options.filesRoot ?? path.resolve('data', 'files'),
  );

  // UC3 is built on UC2 rather than beside it: a sale is a transaction, and
  // recording one must go through the same validation as any other leg.
  const recordTransaction = new RecordTransaction({
    transactions,
    payouts,
    accounts,
    currencies,
  });

  const lifetime =
    options.sessionLifetimeMs === undefined
      ? {}
      : { sessionLifetimeMs: options.sessionLifetimeMs };

  const useCases: UseCases = {
    recordCompany: new RecordCompany({ companies }),
    listCompanies: new ListCompanies({ companies }),

    recordAccount: new RecordAccount({ accounts, companies, currencies }),
    listAccounts: new ListAccounts({ accounts }),

    recordPayout: new RecordPayout({ payouts, companies, currencies, clock }),
    deletePayout: new DeletePayout({ payouts, transactions }),
    listPayouts: new ListPayouts({ payouts }),
    getPayoutTrail: new GetPayoutTrail({ payouts, transactions, documents }),
    getSettlement: new GetSettlement({
      payouts,
      transactions,
      accounts,
      currencies,
    }),

    recordTransaction,
    recordSale: new RecordSale({
      recordTransaction,
      transactions,
      feeSchedules,
      currencies,
    }),
    listTransactions: new ListTransactions({ transactions }),

    attachDocument: new AttachDocument({ documents, store }),
    getDocument: new GetDocument({ documents, store }),
    searchDocuments: new SearchDocuments({ documents }),

    getAccountBalances: new GetAccountBalances({ accounts, transactions }),
    runDataQualityChecks: new RunDataQualityChecks({
      payouts,
      transactions,
      accounts,
      feeSchedules,
    }),
    generateFinancialYearReport: new GenerateFinancialYearReport({
      payouts,
      companies,
      transactions,
      currencies,
      clock,
    }),

    signIn: new SignIn({ users, sessions, hasher, ids, clock, ...lifetime }),
    signOut: new SignOut({ sessions, clock }),
    authenticate: new AuthenticateSession({
      sessions,
      users,
      clock,
      ...lifetime,
    }),
    changeCredentials: new ChangeCredentials({
      users,
      sessions,
      hasher,
      clock,
    }),
  };

  const importLegacyCsv = new ImportLegacyCsv({
    csv: new FileCsvReader(),
    companies,
    accounts,
    payouts,
    transactions,
    documents,
    currencies,
  });

  return { useCases, documentFiles: store, users, hasher, importLegacyCsv };
}
