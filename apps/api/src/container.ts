import {
  AuthenticateSession,
  ChangeCredentials,
  GetAccountBalances,
  SignIn,
  SignOut,
} from '@payout/core';

import { CryptoIdGenerator } from './adapters/crypto-id-generator';
import { SqliteAccountRepository } from './adapters/sqlite-account-repository';
import { SqliteSessionRepository } from './adapters/sqlite-session-repository';
import { SqliteTransactionRepository } from './adapters/sqlite-transaction-repository';
import { SqliteUserRepository } from './adapters/sqlite-user-repository';
import { loadCurrencyRegistry } from './adapters/currency-registry';
import { SystemClock } from './adapters/system-clock';
import { Argon2PasswordHasher } from './auth/argon2-password-hasher';
import type { SqliteDatabase } from './db/connection';

/**
 * The only file that knows about everything (CLAUDE.md §5).
 *
 * Adapters are constructed here, use cases are given them here, and nowhere
 * else in the application does a use case learn what a repository is made of.
 * A route receives a use case; a use case receives a port.
 */
export interface Container {
  readonly signIn: SignIn;
  readonly signOut: SignOut;
  readonly authenticate: AuthenticateSession;
  readonly changeCredentials: ChangeCredentials;
  readonly getAccountBalances: GetAccountBalances;
  readonly hasher: Argon2PasswordHasher;
  readonly users: SqliteUserRepository;
}

export interface ContainerOptions {
  /** Overridable so a test can expire a session without waiting a month. */
  readonly sessionLifetimeMs?: number;
  readonly clock?: { now(): Date; today(): string };
  readonly ids?: { newId(): string };
}

export function buildContainer(
  database: SqliteDatabase,
  options: ContainerOptions = {},
): Container {
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new CryptoIdGenerator();
  const hasher = new Argon2PasswordHasher();

  const users = new SqliteUserRepository(database);
  const sessions = new SqliteSessionRepository(database);
  const accounts = new SqliteAccountRepository(database);
  const currencies = loadCurrencyRegistry(database);
  const transactions = new SqliteTransactionRepository(database, currencies);

  const lifetime =
    options.sessionLifetimeMs === undefined
      ? {}
      : { sessionLifetimeMs: options.sessionLifetimeMs };

  return {
    hasher,
    users,
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
    getAccountBalances: new GetAccountBalances({ accounts, transactions }),
  };
}
