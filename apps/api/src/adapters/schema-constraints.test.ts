import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

/**
 * CLAUDE.md §7 lists invariants "enforced by database constraints — do not
 * duplicate in application code". This file is the receipt. Every assertion
 * here goes through raw SQL rather than an adapter, because the claim is
 * about the database, not about the code in front of it: if an importer, a
 * migration or a hand-typed `sqlite3` session tried these, they would fail
 * too.
 *
 * The constraints only hold because `foreign_keys` is ON, which is a
 * per-connection pragma set in openDatabase. The last test in the file is
 * there to catch the day somebody removes that line.
 */
describe('schema constraints (CLAUDE.md §7)', () => {
  let database: SqliteDatabase;

  const seed = (): void => {
    database.exec(`
      INSERT INTO companies (id, code, name) VALUES (1, 'Tradeify001', 'Tradeify');
      INSERT INTO accounts (id, code, name, type) VALUES
        (1, 'coindcx', 'CoinDCX', 'exchange'),
        (2, 'bank-hdfc', 'HDFC', 'bank');
      INSERT INTO payouts (id, code, company_id, trader_id, payout_date, gross_amount, currency_code)
        VALUES (1, 'TradeifyPayout001', 1, 1, '2025-03-10', 100801, 'USD');
      INSERT INTO transactions
        (id, code, payout_id, txn_date, kind, from_account_id, to_account_id,
         from_amount, from_currency, to_amount, to_currency, rate_applied)
        VALUES
        (1, 'Transaction003', 1, '2025-03-16', 'sale', 1, 2,
         4522920000, 'USDT', 441732, 'INR', 9766520000);
      INSERT INTO documents (id, filename, stored_path, sha256)
        VALUES (1, 'statement.pdf', 'ab/cd/abcd.pdf', 'abcd');
    `);
  };

  /** The SQLITE_CONSTRAINT_* code, which is more precise than the message. */
  const codeOf = (run: () => void): string => {
    try {
      run();
    } catch (error) {
      return (error as { code?: string }).code ?? 'NO_CODE';
    }
    return 'NO_ERROR';
  };

  beforeEach(() => {
    database = openTestDatabase();
    seed();
  });

  afterEach(() => {
    database.close();
  });

  it('rejects a transaction whose two sides are the same account', () => {
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transactions
               (code, payout_id, txn_date, kind, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency)
             VALUES ('T-same', 1, '2025-03-16', 'transfer', 1, 1, 100, 'INR', 100, 'INR')`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('rejects a rate on a move that does not change currency', () => {
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transactions
               (code, payout_id, txn_date, kind, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency, rate_applied)
             VALUES ('T-rate', 1, '2025-03-16', 'transfer', 1, 2, 100, 'INR', 100, 'INR', 100000000)`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('accepts the same move with no rate, which is the point of the rule', () => {
    expect(() => {
      database
        .prepare(
          `INSERT INTO transactions
             (code, payout_id, txn_date, kind, from_account_id, to_account_id,
              from_amount, from_currency, to_amount, to_currency, rate_applied)
           VALUES ('T-norate', 1, '2025-03-16', 'transfer', 1, 2, 100, 'INR', 100, 'INR', NULL)`,
        )
        .run();
    }).not.toThrow();
  });

  it('accepts a cross-currency move with no rate — suspicious, not impossible', () => {
    // §7 is explicit that this one is a view's job, not a constraint's.
    expect(() => {
      database
        .prepare(
          `INSERT INTO transactions
             (code, payout_id, txn_date, kind, from_account_id, to_account_id,
              from_amount, from_currency, to_amount, to_currency, rate_applied)
           VALUES ('T-unknownrate', 1, '2025-03-16', 'sale', 1, 2, 100, 'USDT', 9825, 'INR', NULL)`,
        )
        .run();
    }).not.toThrow();
  });

  it('rejects two fees of the same type on one transaction', () => {
    database
      .prepare(
        `INSERT INTO transaction_fees (transaction_id, fee_type, amount, currency_code)
         VALUES (1, 'exchange_fee', 2209, 'INR')`,
      )
      .run();

    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transaction_fees (transaction_id, fee_type, amount, currency_code)
             VALUES (1, 'exchange_fee', 370640, 'INR')`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_UNIQUE');
  });

  it('accepts two fees of different types on one transaction', () => {
    expect(() => {
      database.exec(`
        INSERT INTO transaction_fees (transaction_id, fee_type, amount, currency_code)
          VALUES (1, 'exchange_fee', 2209, 'INR');
        INSERT INTO transaction_fees (transaction_id, fee_type, amount, currency_code)
          VALUES (1, 'gst', 398, 'INR');
      `);
    }).not.toThrow();
  });

  it('rejects a document link with two targets set', () => {
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO document_links (document_id, company_id, payout_id)
             VALUES (1, 1, 1)`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('rejects a document link with no target at all', () => {
    expect(
      codeOf(() => {
        database
          .prepare('INSERT INTO document_links (document_id) VALUES (1)')
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('accepts a document link with exactly one target', () => {
    expect(() => {
      database.exec(`
        INSERT INTO document_links (document_id, payout_id) VALUES (1, 1);
        INSERT INTO document_links (document_id, transaction_id) VALUES (1, 1);
      `);
    }).not.toThrow();
  });

  it('rejects a non-positive amount on either side of a transaction', () => {
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transactions
               (code, payout_id, txn_date, kind, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency)
             VALUES ('T-zero', 1, '2025-03-16', 'transfer', 1, 2, 0, 'INR', 100, 'INR')`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transactions
               (code, payout_id, txn_date, kind, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency)
             VALUES ('T-date', 1, '16/03/2025', 'transfer', 1, 2, 100, 'INR', 100, 'INR')`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('rejects a parent transaction that does not exist', () => {
    // Not in §7's list, but it is why the in-memory fake and the database
    // disagreed about orphan legs — see the note in get-payout-trail.test.ts.
    expect(
      codeOf(() => {
        database
          .prepare(
            `INSERT INTO transactions
               (code, payout_id, parent_id, txn_date, kind, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency)
             VALUES ('T-orphan', 1, 9999, '2025-03-16', 'transfer', 1, 2, 100, 'INR', 100, 'INR')`,
          )
          .run();
      }),
    ).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('has foreign keys switched on, which is what makes the rest true', () => {
    // 1n, not 1: the connection runs in safe-integer mode so that no money
    // column ever arrives as a float64.
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1n);
  });
});
