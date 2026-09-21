import type {
  Account,
  Company,
  CurrencyRegistry,
  Document,
  FeeSchedule,
  Payout,
  Trader,
  Transaction,
  TransactionFee,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import {
  toAccount,
  toCompany,
  toDocument,
  toFeeSchedule,
  toPayout,
  toTransaction,
  toTransactionFee,
  type AccountRow,
  type CompanyRow,
  type DocumentRow,
  type FeeScheduleRow,
  type PayoutRow,
  type TransactionFeeRow,
  type TransactionRow,
} from './mappers';

/**
 * Bulk operations that work on whole entities with their ids already decided.
 *
 * The repositories deliberately let SQLite allocate ids, which is right for
 * anything a person enters. Two jobs need the opposite: the one-off legacy CSV
 * import (F12), which has to preserve the sheet's own numbering so the
 * corrections in §9 can be traced back, and restoring a backup. Both want to
 * write a whole graph at once, and both want it to be all-or-nothing.
 */

const SQL = {
  insertCompany:
    'INSERT INTO companies (id, code, name, notes) VALUES (@id, @code, @name, @notes)',
  insertAccount:
    'INSERT INTO accounts (id, code, name, type, company_id) VALUES (@id, @code, @name, @type, @companyId)',
  insertAccountCurrency:
    'INSERT OR IGNORE INTO account_currencies (account_id, currency_code) VALUES (?, ?)',
  insertTrader:
    'INSERT OR IGNORE INTO traders (id, code, name, notes) VALUES (@id, @code, @name, @notes)',
  insertPayout: `INSERT INTO payouts
      (id, code, company_id, trader_id, payout_date, reference, gross_amount, charges, currency_code, notes)
    VALUES
      (@id, @code, @companyId, @traderId, @payoutDate, @reference, @gross, @charges, @currencyCode, @notes)`,
  insertTransaction: `INSERT INTO transactions
      (id, code, payout_id, parent_id, txn_date, kind, from_account_id, to_account_id,
       from_amount, from_currency, to_amount, to_currency, rate_applied,
       from_external_ref, to_external_ref, notes)
    VALUES
      (@id, @code, @payoutId, @parentId, @txnDate, @kind, @fromAccountId, @toAccountId,
       @fromAmount, @fromCurrency, @toAmount, @toCurrency, @rate,
       @fromExternalRef, @toExternalRef, @notes)`,
  insertFee: `INSERT INTO transaction_fees (id, transaction_id, fee_type, amount, currency_code)
    VALUES (@id, @transactionId, @feeType, @amount, @currencyCode)`,
  insertFeeSchedule: `INSERT INTO fee_schedules
      (id, account_id, fee_type, basis, rate_bps, flat_amount, currency_code, effective_from, effective_to)
    VALUES
      (@id, @accountId, @feeType, @basis, @rateBps, @flatAmount, @currencyCode, @effectiveFrom, @effectiveTo)`,
  insertDocument: `INSERT INTO documents
      (id, filename, stored_path, mime_type, byte_size, sha256, doc_type, doc_date, extracted_text)
    VALUES
      (@id, @filename, @storedPath, @mimeType, @byteSize, @sha256, @docType, @docDate, @extractedText)`,
} as const;

export interface BulkLoad {
  /**
   * The people the payouts belong to (F24).
   *
   * `INSERT OR IGNORE`, because `004_traders.sql` already created trader 1
   * and a fixture that names the same person is agreeing with the migration
   * rather than fighting it.
   */
  readonly traders?: readonly Trader[];
  readonly companies?: readonly Company[];
  readonly accounts?: readonly Account[];
  readonly payouts?: readonly Payout[];
  readonly transactions?: readonly Transaction[];
  readonly fees?: readonly TransactionFee[];
  readonly feeSchedules?: readonly FeeSchedule[];
  readonly documents?: readonly Document[];
}

/**
 * Write a whole graph in one transaction, ids and all.
 *
 * `defer_foreign_keys` holds every foreign key check until commit, so a leg
 * may name a parent that appears later in the batch. The checks still run —
 * at commit, on the finished graph — so a genuinely dangling reference still
 * fails and takes the whole load with it. It is ordering that is relaxed, not
 * integrity. The pragma resets itself when the transaction ends.
 */
export function bulkLoad(database: SqliteDatabase, data: BulkLoad): void {
  const insertCompany = database.prepare(SQL.insertCompany);
  const insertAccount = database.prepare(SQL.insertAccount);
  const insertAccountCurrency = database.prepare(SQL.insertAccountCurrency);
  const insertTrader = database.prepare(SQL.insertTrader);
  const insertPayout = database.prepare(SQL.insertPayout);
  const insertTransaction = database.prepare(SQL.insertTransaction);
  const insertFee = database.prepare(SQL.insertFee);
  const insertFeeSchedule = database.prepare(SQL.insertFeeSchedule);
  const insertDocument = database.prepare(SQL.insertDocument);

  const load = database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');

    for (const trader of data.traders ?? []) {
      insertTrader.run({
        id: trader.id,
        code: trader.code,
        name: trader.name,
        notes: trader.notes,
      });
    }

    for (const company of data.companies ?? []) {
      insertCompany.run({
        id: company.id,
        code: company.code,
        name: company.name,
        notes: company.notes,
      });
    }

    for (const account of data.accounts ?? []) {
      insertAccount.run({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        companyId: account.companyId,
      });
      for (const code of account.allowedCurrencies) {
        insertAccountCurrency.run(account.id, code);
      }
    }

    for (const payout of data.payouts ?? []) {
      insertPayout.run({
        id: payout.id,
        code: payout.code,
        companyId: payout.companyId,
        traderId: payout.traderId,
        payoutDate: payout.payoutDate,
        reference: payout.reference,
        gross: payout.gross.minor,
        charges: payout.charges.minor,
        currencyCode: payout.gross.currency.code,
        notes: payout.notes,
      });
    }

    for (const transaction of data.transactions ?? []) {
      insertTransaction.run({
        id: transaction.id,
        code: transaction.code,
        payoutId: transaction.payoutId,
        parentId: transaction.parentId,
        txnDate: transaction.txnDate,
        kind: transaction.kind,
        fromAccountId: transaction.fromAccountId,
        toAccountId: transaction.toAccountId,
        fromAmount: transaction.fromAmount.minor,
        fromCurrency: transaction.fromAmount.currency.code,
        toAmount: transaction.toAmount.minor,
        toCurrency: transaction.toAmount.currency.code,
        rate: transaction.rate,
        fromExternalRef: transaction.fromExternalRef,
        toExternalRef: transaction.toExternalRef,
        notes: transaction.notes,
      });
    }

    for (const fee of data.fees ?? []) {
      insertFee.run({
        id: fee.id,
        transactionId: fee.transactionId,
        feeType: fee.feeType,
        amount: fee.amount.minor,
        currencyCode: fee.amount.currency.code,
      });
    }

    for (const schedule of data.feeSchedules ?? []) {
      insertFeeSchedule.run({
        id: schedule.id,
        accountId: schedule.accountId,
        feeType: schedule.feeType,
        basis: schedule.basis,
        rateBps: schedule.rateBps,
        flatAmount: schedule.flatAmount?.minor ?? null,
        currencyCode: schedule.flatAmount?.currency.code ?? null,
        effectiveFrom: schedule.effectiveFrom,
        effectiveTo: schedule.effectiveTo,
      });
    }

    for (const document of data.documents ?? []) {
      insertDocument.run({
        id: document.id,
        filename: document.filename,
        storedPath: document.storedPath,
        mimeType: document.mimeType,
        byteSize: document.byteSize,
        sha256: document.sha256,
        docType: document.docType,
        docDate: document.docDate,
        extractedText: document.extractedText,
      });
    }
  });

  load();
}

/** The tables a row count is meaningful for. Not a free-text table name. */
export type CountableTable =
  | 'traders'
  | 'companies'
  | 'accounts'
  | 'payouts'
  | 'transactions'
  | 'transaction_fees'
  | 'fee_schedules'
  | 'documents'
  | 'document_links'
  | 'schema_migrations';

/**
 * How many rows a table holds, synchronously.
 *
 * For diagnostics, for the summary line an import prints, and for tests that
 * need to assert "one document, two links" without awaiting a repository.
 */
export function countRows(
  database: SqliteDatabase,
  table: CountableTable,
): number {
  const row = database
    .prepare<[], { total: bigint }>(`SELECT COUNT(*) AS total FROM ${table}`)
    .get();

  return Number(row?.total ?? 0n);
}

/** The mirror of BulkLoad: every row, as entities, synchronously. */
export interface LedgerSnapshot {
  readonly companies: readonly Company[];
  readonly accounts: readonly Account[];
  readonly payouts: readonly Payout[];
  readonly transactions: readonly Transaction[];
  readonly fees: readonly TransactionFee[];
  readonly feeSchedules: readonly FeeSchedule[];
  readonly documents: readonly Document[];
}

/**
 * Read the whole ledger out in one go.
 *
 * `bulkLoad` writes a graph; this reads one back. Between them they are what a
 * backup, an export and a diagnostic dump need, and they are synchronous
 * because better-sqlite3 is — the repositories return promises to keep the
 * ports honest about what a different adapter might need, not because
 * anything here yields.
 */
export function snapshot(
  database: SqliteDatabase,
  currencies: CurrencyRegistry,
): LedgerSnapshot {
  const rows = <Row>(sql: string): readonly Row[] =>
    database.prepare<[], Row>(sql).all();

  return {
    companies: rows<CompanyRow>(
      'SELECT id, code, name, notes FROM companies ORDER BY id',
    ).map(toCompany),
    accounts: rows<AccountRow>(
      'SELECT id, code, name, type, company_id FROM accounts ORDER BY id',
    ).map((row) =>
      toAccount(
        row,
        database
          .prepare<[number], { currency_code: string }>(
            'SELECT currency_code FROM account_currencies WHERE account_id = ?',
          )
          .all(Number(row.id))
          .map((entry) => entry.currency_code),
      ),
    ),
    payouts: rows<PayoutRow>(
      `SELECT id, code, company_id, trader_id, payout_date, reference,
              gross_amount, charges, currency_code, notes
         FROM payouts ORDER BY id`,
    ).map((row) => toPayout(row, currencies)),
    transactions: rows<TransactionRow>(
      `SELECT id, code, payout_id, parent_id, txn_date, kind, from_account_id,
              to_account_id, from_amount, from_currency, to_amount, to_currency,
              rate_applied, from_external_ref, to_external_ref, notes
         FROM transactions ORDER BY id`,
    ).map((row) => toTransaction(row, currencies)),
    fees: rows<TransactionFeeRow>(
      'SELECT id, transaction_id, fee_type, amount, currency_code FROM transaction_fees ORDER BY id',
    ).map((row) => toTransactionFee(row, currencies)),
    feeSchedules: rows<FeeScheduleRow>(
      `SELECT id, account_id, fee_type, basis, rate_bps, flat_amount,
              currency_code, effective_from, effective_to FROM fee_schedules ORDER BY id`,
    ).map((row) => toFeeSchedule(row, currencies)),
    documents: rows<DocumentRow>(
      `SELECT id, filename, stored_path, mime_type, byte_size, sha256,
              doc_type, doc_date, extracted_text FROM documents ORDER BY id`,
    ).map(toDocument),
  };
}

/**
 * Replace the currency table wholesale.
 *
 * §6 puts the scale in the database, which means a test that wants to prove
 * something reads it from there needs a way to change it. Here rather than in
 * a test file because §12 keeps SQL in the adapter layer, and "except in
 * tests" is how that rule stops meaning anything.
 */
export function replaceCurrencies(
  database: SqliteDatabase,
  rows: readonly {
    code: string;
    scale: number;
    divisor: number;
    kind: 'fiat' | 'crypto';
    symbol: string | null;
  }[],
): void {
  const clear = database.prepare('DELETE FROM currencies');
  const insert = database.prepare(
    'INSERT INTO currencies (code, scale, divisor, kind, symbol) VALUES (@code, @scale, @divisor, @kind, @symbol)',
  );

  database.transaction(() => {
    clear.run();
    for (const row of rows) {
      insert.run(row);
    }
  })();
}
