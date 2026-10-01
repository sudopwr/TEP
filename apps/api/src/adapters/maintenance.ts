import type {
  Account,
  Company,
  CurrencyRegistry,
  Document,
  DocumentId,
  DocumentTarget,
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
  toTrader,
  toTransaction,
  toTransactionFee,
  type AccountRow,
  type CompanyRow,
  type DocumentRow,
  type FeeScheduleRow,
  type PayoutRow,
  type TraderRow,
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
       from_external_ref, to_external_ref, from_address, to_address, explorer_url, notes)
    VALUES
      (@id, @code, @payoutId, @parentId, @txnDate, @kind, @fromAccountId, @toAccountId,
       @fromAmount, @fromCurrency, @toAmount, @toCurrency, @rate,
       @fromExternalRef, @toExternalRef, @fromAddress, @toAddress, @explorerUrl, @notes)`,
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
  insertDocumentLink: `INSERT INTO document_links
      (id, document_id, company_id, payout_id, transaction_id, role)
    VALUES
      (@id, @documentId, @companyId, @payoutId, @transactionId, @role)`,
} as const;

/**
 * What a document is attached to, as a row rather than a call (F6).
 *
 * The repository writes a link through `link(documentId, target, role)`, which
 * lets SQLite pick the id — right for an attachment somebody makes, and wrong
 * for a restore, which has to put back the same graph it took out. Core has no
 * entity for this, because nothing in the domain needs one: a link is a fact
 * about two ids, and `DocumentTarget` already says which two.
 */
export interface DocumentAttachment {
  readonly id: number;
  readonly documentId: DocumentId;
  readonly target: DocumentTarget;
  readonly role: string | null;
}

/** The three nullable columns, from the one target that is set. */
function targetColumns(target: DocumentTarget): {
  companyId: number | null;
  payoutId: number | null;
  transactionId: number | null;
} {
  return {
    companyId: target.kind === 'company' ? target.id : null,
    payoutId: target.kind === 'payout' ? target.id : null,
    transactionId: target.kind === 'transaction' ? target.id : null,
  };
}

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
  /**
   * The attachments, which a restore must put back with the documents (F33).
   *
   * Without these a restored ledger holds every file and shows none of them:
   * the rows survive and nothing points at them.
   */
  readonly documentLinks?: readonly DocumentAttachment[];
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
  const insertDocumentLink = database.prepare(SQL.insertDocumentLink);

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
        // F28's three, which this statement used to leave out — so a restore
        // kept every amount and quietly dropped every wallet address.
        fromAddress: transaction.fromAddress,
        toAddress: transaction.toAddress,
        explorerUrl: transaction.explorerUrl,
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

    for (const link of data.documentLinks ?? []) {
      insertDocumentLink.run({
        id: link.id,
        documentId: link.documentId,
        role: link.role,
        ...targetColumns(link.target),
      });
    }
  });

  load();
}

/**
 * Empty the ledger, leaving the installation behind.
 *
 * What goes: every trader, company, account, payout, leg, fee, schedule,
 * document row and attachment. What stays: the `users` row and its sessions
 * (§5a — a restore must not sign anybody in or out, and an archive carries no
 * credential at all), the `currencies` table (§6's scales are seeded by the
 * migrations and are the same in every install) and `schema_migrations`.
 *
 * Deepest first, so each `DELETE` only ever removes rows nothing points at.
 * `ON DELETE CASCADE` would reach most of this from `payouts` alone, but a
 * wipe that leans on cascades deletes whatever the schema happens to cascade
 * today; naming the tables says what is being destroyed, in a function whose
 * whole job is destroying it.
 *
 * Files are not touched. They are content-addressed and referenced by nothing
 * but the rows just deleted, so leaving them costs some disk and no
 * correctness — and an import that fails halfway has not thrown away the one
 * copy of a statement. `data/files` is the owner's to prune.
 */
export function clearLedger(database: SqliteDatabase): void {
  const TABLES = [
    'document_links',
    'transaction_fees',
    'transactions',
    'payouts',
    'fee_schedules',
    'account_currencies',
    'accounts',
    'documents',
    'companies',
    'traders',
  ] as const;

  const clear = database.transaction(() => {
    /*
      Deferred, for the same reason `bulkLoad` defers: `transactions.parent_id`
      references `transactions(id)` ON DELETE RESTRICT, and RESTRICT is checked
      row by row as the statement runs. So `DELETE FROM transactions` refuses
      the first parent it reaches, because a child still points at it — even
      though the same statement is about to delete that child too. Holding the
      checks until commit asks the question once, of the finished state, where
      the table is empty and nothing dangles. The checks still run: a reference
      left behind by a wrong table order would still fail, and take the whole
      wipe with it.
    */
    database.pragma('defer_foreign_keys = ON');

    for (const table of TABLES) {
      database.prepare(`DELETE FROM ${table}`).run();
    }
  });

  clear();
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
  readonly traders: readonly Trader[];
  readonly companies: readonly Company[];
  readonly accounts: readonly Account[];
  readonly payouts: readonly Payout[];
  readonly transactions: readonly Transaction[];
  readonly fees: readonly TransactionFee[];
  readonly feeSchedules: readonly FeeSchedule[];
  readonly documents: readonly Document[];
  readonly documentLinks: readonly DocumentAttachment[];
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
    traders: rows<TraderRow>(
      'SELECT id, code, name, notes FROM traders ORDER BY id',
    ).map(toTrader),
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
              rate_applied, from_external_ref, to_external_ref,
              from_address, to_address, explorer_url, notes
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
    documentLinks: rows<DocumentLinkRow>(
      `SELECT id, document_id, company_id, payout_id, transaction_id, role
         FROM document_links ORDER BY id`,
    ).map(toAttachment),
  };
}

/** The one target of the three nullable columns — §7's CHECK guarantees one. */
function toAttachment(row: DocumentLinkRow): DocumentAttachment {
  const target: DocumentTarget =
    row.company_id !== null
      ? { kind: 'company', id: Number(row.company_id) }
      : row.payout_id !== null
        ? { kind: 'payout', id: Number(row.payout_id) }
        : { kind: 'transaction', id: Number(row.transaction_id) };

  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    target,
    role: row.role,
  };
}

/** Shaped like the other `*Row` types in `mappers.ts`, and local for the same
 *  reason `document_links` has no entity: only this file reads these rows. */
interface DocumentLinkRow {
  readonly id: number | bigint;
  readonly document_id: number | bigint;
  readonly company_id: number | bigint | null;
  readonly payout_id: number | bigint | null;
  readonly transaction_id: number | bigint;
  readonly role: string | null;
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
