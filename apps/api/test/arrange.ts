import type { CurrencyRegistry } from '@payout/core';
import * as reference from '@core/domain/reference-payout.fixture';

import { loadCurrencyRegistry } from '../src/adapters/currency-registry';
import { bulkLoad } from '../src/adapters/maintenance';
import type { SqliteDatabase } from '../src/db/connection';

import { openTestDatabase } from './open-test-database';

export interface Arranged {
  readonly database: SqliteDatabase;
  readonly currencies: CurrencyRegistry;
}

/** A migrated database with the companies and accounts already in it. */
export function arrangeCounterparties(): Arranged {
  const database = openTestDatabase();

  bulkLoad(database, {
    companies: [reference.TRADEIFY, reference.RISE_CO],
    accounts: [
      reference.TRADEIFY_ACCOUNT,
      reference.RISE,
      reference.TRUSTWALLET,
      reference.COINDCX,
      reference.BANK,
    ],
  });

  return { database, currencies: loadCurrencyRegistry(database) };
}

/** The whole verified TradeifyPayout001 tree, fees and all. */
export function arrangeReferencePayout(): Arranged {
  const arranged = arrangeCounterparties();

  bulkLoad(arranged.database, {
    payouts: [reference.PAYOUT],
    transactions: [...reference.TRANSACTIONS],
    fees: [...reference.FEES],
    feeSchedules: [...reference.FEE_SCHEDULES],
  });

  return arranged;
}

export { reference };
