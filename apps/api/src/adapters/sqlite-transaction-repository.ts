import {
  Transaction as TransactionEntity,
  TransactionFee as TransactionFeeEntity,
} from '@payout/core';
import type {
  CurrencyRegistry,
  PayoutId,
  Transaction,
  TransactionDraft,
  TransactionFee,
  TransactionFeeDraft,
  TransactionId,
  TransactionRepository,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import {
  toTransaction,
  toTransactionFee,
  type TransactionFeeRow,
  type TransactionRow,
} from './mappers';

const TXN_COLUMNS = `id, code, payout_id, parent_id, txn_date, kind,
  from_account_id, to_account_id, from_amount, from_currency,
  to_amount, to_currency, rate_applied, from_external_ref, to_external_ref, notes`;

const FEE_COLUMNS = 'id, transaction_id, fee_type, amount, currency_code';

const SQL = {
  selectById: `SELECT ${TXN_COLUMNS} FROM transactions WHERE id = ?`,
  selectByCode: `SELECT ${TXN_COLUMNS} FROM transactions WHERE code = ?`,
  selectAll: `SELECT ${TXN_COLUMNS} FROM transactions ORDER BY id`,
  selectByPayout: `SELECT ${TXN_COLUMNS} FROM transactions WHERE payout_id = ? ORDER BY id`,
  selectChildren: `SELECT ${TXN_COLUMNS} FROM transactions WHERE parent_id = ? ORDER BY id`,
  insert: `INSERT INTO transactions
             (code, payout_id, parent_id, txn_date, kind,
              from_account_id, to_account_id, from_amount, from_currency,
              to_amount, to_currency, rate_applied,
              from_external_ref, to_external_ref, notes)
           VALUES
             (@code, @payoutId, @parentId, @txnDate, @kind,
              @fromAccountId, @toAccountId, @fromAmount, @fromCurrency,
              @toAmount, @toCurrency, @rate,
              @fromExternalRef, @toExternalRef, @notes)`,
  update: `UPDATE transactions SET
             code = @code, payout_id = @payoutId, parent_id = @parentId,
             txn_date = @txnDate, kind = @kind,
             from_account_id = @fromAccountId, to_account_id = @toAccountId,
             from_amount = @fromAmount, from_currency = @fromCurrency,
             to_amount = @toAmount, to_currency = @toCurrency,
             rate_applied = @rate, from_external_ref = @fromExternalRef,
             to_external_ref = @toExternalRef, notes = @notes
           WHERE id = @id`,

  selectAllFees: `SELECT ${FEE_COLUMNS} FROM transaction_fees ORDER BY id`,
  selectFeesByPayout: `SELECT f.id, f.transaction_id, f.fee_type, f.amount, f.currency_code
                         FROM transaction_fees f
                         JOIN transactions t ON t.id = f.transaction_id
                        WHERE t.payout_id = ?
                        ORDER BY f.id`,
  selectFeesByTransaction: `SELECT ${FEE_COLUMNS} FROM transaction_fees WHERE transaction_id = ? ORDER BY id`,
  selectFeeById: `SELECT ${FEE_COLUMNS} FROM transaction_fees WHERE id = ?`,
  /**
   * One fee per type per transaction is a UNIQUE constraint, so recording a
   * type twice replaces rather than duplicates — which is what the port
   * promises. A raw second INSERT still fails, and the schema test proves it.
   */
  upsertFee: `INSERT INTO transaction_fees (transaction_id, fee_type, amount, currency_code)
              VALUES (@transactionId, @feeType, @amount, @currencyCode)
              ON CONFLICT (transaction_id, fee_type) DO UPDATE SET
                amount = excluded.amount,
                currency_code = excluded.currency_code
              RETURNING id`,
  /*
    One layer of the subtree: the legs at or under `?` that are nobody's parent.

    The same shape as `SqlitePayoutRepository`'s peel, and for the same reason
    — `parent_id` is ON DELETE RESTRICT, which SQLite checks the instant a row
    goes rather than at the end of the statement, so deleting a leg that still
    has children fails with a bare "FOREIGN KEY constraint failed" no matter
    what order a single DELETE would have reached them in.

    The recursive CTE names the subtree; the `NOT IN` keeps each pass to its
    current leaves. Run until it changes nothing and the subtree is gone,
    deepest first, which is the only order the constraint allows.
  */
  deleteLeavesUnder: `WITH RECURSIVE subtree(id) AS (
                          SELECT id FROM transactions WHERE id = ?
                        UNION ALL
                          SELECT t.id FROM transactions t
                            JOIN subtree s ON t.parent_id = s.id
                      )
                      DELETE FROM transactions
                       WHERE id IN (SELECT id FROM subtree)
                         AND id NOT IN (SELECT parent_id FROM transactions
                                         WHERE parent_id IS NOT NULL)`,
} as const;

/**
 * The id a draft does not have yet.
 *
 * Drafts are validated by constructing the entity before the row is written,
 * so an invariant breach arrives as a named domain error rather than as a
 * SQLite CHECK message. Construction needs an id; the database has not
 * allocated one yet, and this placeholder is never stored. The constraints
 * still exist and still run — this only gets there first, in the domain's own
 * vocabulary, which is the exemption CLAUDE.md §7 allows for a friendlier
 * message.
 */
const UNASSIGNED_ID = 0;

interface TransactionWrite {
  readonly code: string;
  readonly payoutId: number;
  readonly parentId: number | null;
  readonly txnDate: string;
  readonly kind: string;
  readonly fromAccountId: number;
  readonly toAccountId: number;
  readonly fromAmount: bigint;
  readonly fromCurrency: string;
  readonly toAmount: bigint;
  readonly toCurrency: string;
  readonly rate: bigint | null;
  readonly fromExternalRef: string | null;
  readonly toExternalRef: string | null;
  readonly notes: string | null;
}

export class SqliteTransactionRepository implements TransactionRepository {
  readonly #currencies: CurrencyRegistry;
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #selectByPayout;
  readonly #selectChildren;
  readonly #insert;
  readonly #update;
  readonly #selectAllFees;
  readonly #selectFeesByPayout;
  readonly #selectFeesByTransaction;
  readonly #selectFeeById;
  readonly #upsertFee;
  readonly #deleteLeavesUnder;
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    this.#database = database;
    this.#currencies = currencies;
    this.#selectById = database.prepare<[number], TransactionRow>(
      SQL.selectById,
    );
    this.#selectByCode = database.prepare<[string], TransactionRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], TransactionRow>(SQL.selectAll);
    this.#selectByPayout = database.prepare<[number], TransactionRow>(
      SQL.selectByPayout,
    );
    this.#selectChildren = database.prepare<[number], TransactionRow>(
      SQL.selectChildren,
    );
    this.#insert = database.prepare<TransactionWrite>(SQL.insert);
    this.#update = database.prepare<TransactionWrite & { id: number }>(
      SQL.update,
    );
    this.#selectAllFees = database.prepare<[], TransactionFeeRow>(
      SQL.selectAllFees,
    );
    this.#selectFeesByPayout = database.prepare<[number], TransactionFeeRow>(
      SQL.selectFeesByPayout,
    );
    this.#selectFeesByTransaction = database.prepare<
      [number],
      TransactionFeeRow
    >(SQL.selectFeesByTransaction);
    this.#selectFeeById = database.prepare<[number], TransactionFeeRow>(
      SQL.selectFeeById,
    );
    this.#upsertFee = database.prepare<
      {
        transactionId: number;
        feeType: string;
        amount: bigint;
        currencyCode: string;
      },
      { id: bigint }
    >(SQL.upsertFee);
    this.#deleteLeavesUnder = database.prepare<[number]>(SQL.deleteLeavesUnder);
  }

  /**
   * The leg, the legs below it, their fees and the links to any of them.
   *
   * One unit of work, because the first statement runs several times: half a
   * peeled subtree is a set of legs whose parent is gone, which is the exact
   * shape §7 has no constraint against and `GetPayoutTrail` would render as
   * orphaned roots. `transaction_fees` and `document_links` need no statement
   * of their own — both cascade from the rows going.
   */
  async delete(id: TransactionId): Promise<void> {
    const remove = this.#database.transaction((transactionId: number) => {
      // Bounded by the depth of the subtree: each pass removes its current
      // leaves, so a pass that removes nothing means nothing is left.
      for (;;) {
        const { changes } = this.#deleteLeavesUnder.run(transactionId);
        if (changes === 0) break;
      }
    });

    remove(id);
    return Promise.resolve();
  }

  async findById(id: TransactionId): Promise<Transaction | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : this.#map(row));
  }

  async findByCode(code: string): Promise<Transaction | null> {
    const row = this.#selectByCode.get(code);
    return Promise.resolve(row === undefined ? null : this.#map(row));
  }

  async list(): Promise<readonly Transaction[]> {
    return Promise.resolve(this.#selectAll.all().map((row) => this.#map(row)));
  }

  async listByPayout(payoutId: PayoutId): Promise<readonly Transaction[]> {
    return Promise.resolve(
      this.#selectByPayout.all(payoutId).map((row) => this.#map(row)),
    );
  }

  async listChildren(parentId: TransactionId): Promise<readonly Transaction[]> {
    return Promise.resolve(
      this.#selectChildren.all(parentId).map((row) => this.#map(row)),
    );
  }

  async insert(draft: TransactionDraft): Promise<Transaction> {
    TransactionEntity.record({ ...draft, id: UNASSIGNED_ID });

    const result = this.#insert.run(
      SqliteTransactionRepository.#toWrite(draft),
    );
    return this.#require(Number(result.lastInsertRowid));
  }

  async update(transaction: Transaction): Promise<Transaction> {
    this.#update.run({
      ...SqliteTransactionRepository.#toWrite(transaction),
      id: transaction.id,
    });
    return this.#require(transaction.id);
  }

  async listFees(): Promise<readonly TransactionFee[]> {
    return Promise.resolve(
      this.#selectAllFees.all().map((row) => this.#mapFee(row)),
    );
  }

  async listFeesByPayout(
    payoutId: PayoutId,
  ): Promise<readonly TransactionFee[]> {
    return Promise.resolve(
      this.#selectFeesByPayout.all(payoutId).map((row) => this.#mapFee(row)),
    );
  }

  async listFeesByTransaction(
    transactionId: TransactionId,
  ): Promise<readonly TransactionFee[]> {
    return Promise.resolve(
      this.#selectFeesByTransaction
        .all(transactionId)
        .map((row) => this.#mapFee(row)),
    );
  }

  async recordFee(draft: TransactionFeeDraft): Promise<TransactionFee> {
    TransactionFeeEntity.record({ ...draft, id: UNASSIGNED_ID });

    const written = this.#upsertFee.get({
      transactionId: draft.transactionId,
      feeType: draft.feeType,
      amount: draft.amount.minor,
      currencyCode: draft.amount.currency.code,
    });

    if (written === undefined) {
      throw new Error(
        `transaction_fees row for transaction ${String(draft.transactionId)} was not written`,
      );
    }

    const row = this.#selectFeeById.get(Number(written.id));
    if (row === undefined) {
      throw new Error(
        `transaction_fees row ${String(written.id)} vanished after writing it`,
      );
    }
    return Promise.resolve(this.#mapFee(row));
  }

  static #toWrite(
    transaction: TransactionDraft | Transaction,
  ): TransactionWrite {
    return {
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
      fromExternalRef: transaction.fromExternalRef ?? null,
      toExternalRef: transaction.toExternalRef ?? null,
      notes: transaction.notes ?? null,
    };
  }

  #map(row: TransactionRow): Transaction {
    return toTransaction(row, this.#currencies);
  }

  #mapFee(row: TransactionFeeRow): TransactionFee {
    return toTransactionFee(row, this.#currencies);
  }

  async #require(id: TransactionId): Promise<Transaction> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(
        `transactions row ${String(id)} vanished after writing it`,
      );
    }
    return Promise.resolve(this.#map(row));
  }
}
