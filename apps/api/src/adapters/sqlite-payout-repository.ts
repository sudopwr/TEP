import type {
  CompanyId,
  CurrencyRegistry,
  DateRange,
  Payout,
  PayoutDraft,
  PayoutId,
  PayoutRepository,
  TraderId,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toPayout, type PayoutRow } from './mappers';

const PAYOUT_COLUMNS =
  'id, code, company_id, trader_id, payout_date, reference, gross_amount, charges, currency_code, notes';

/**
 * `status` is deliberately absent from every statement here.
 *
 * The column exists in 001_initial.sql, but CLAUDE.md §13 says status is
 * derived and never stored, and `Payout.status(...)` computes it from the
 * legs. Reading the column would give a second, staler answer to a question
 * that already has one. Inserts let it take its schema default and nothing
 * ever reads it back — the column is carried, not used.
 */
const SQL = {
  selectById: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE id = ?`,
  selectByCode: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE code = ?`,
  selectAll: `SELECT ${PAYOUT_COLUMNS} FROM payouts ORDER BY id`,
  selectByCompany: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE company_id = ? ORDER BY id`,
  /** `ix_payout_trader` covers this and the range query that follows it. */
  selectByTrader: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE trader_id = ? ORDER BY id`,
  selectByDateRange: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE payout_date >= ? AND payout_date <= ? ORDER BY payout_date, id`,
  insert: `INSERT INTO payouts
             (code, company_id, trader_id, payout_date, reference, gross_amount, charges, currency_code, notes)
           VALUES
             (@code, @companyId, @traderId, @payoutDate, @reference, @gross, @charges, @currencyCode, @notes)`,
  update: `UPDATE payouts SET
             code = @code, company_id = @companyId, trader_id = @traderId,
             payout_date = @payoutDate,
             reference = @reference, gross_amount = @gross, charges = @charges,
             currency_code = @currencyCode, notes = @notes
           WHERE id = @id`,
  /*
    One layer of the tree: the legs of this payout that are nobody's parent.

    `transactions.parent_id` is ON DELETE RESTRICT, and RESTRICT is checked
    the instant a row goes rather than at the end of the statement — so a
    plain `DELETE FROM payouts`, whose CASCADE reaches the legs in whatever
    order SQLite likes, fails with a bare "FOREIGN KEY constraint failed" on
    any payout deeper than one level. §10's tree is four.

    Running this until it changes nothing peels the tree from the leaves
    inward, which is the only order the constraint allows. The subquery is
    deliberately not scoped to the payout: a leg of *another* payout pointing
    here would be §7's business, and pretending it away by ignoring it would
    turn a constraint into a silent orphan.
  */
  deleteLeafTransactions: `DELETE FROM transactions
     WHERE payout_id = ?
       AND id NOT IN (SELECT parent_id FROM transactions
                       WHERE parent_id IS NOT NULL)`,
  delete: 'DELETE FROM payouts WHERE id = ?',
} as const;

interface PayoutWrite {
  readonly code: string;
  readonly companyId: number;
  readonly traderId: number;
  readonly payoutDate: string;
  readonly reference: string | null;
  readonly gross: bigint;
  readonly charges: bigint;
  readonly currencyCode: string;
  readonly notes: string | null;
}

export class SqlitePayoutRepository implements PayoutRepository {
  readonly #database: SqliteDatabase;
  readonly #currencies: CurrencyRegistry;
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #selectByCompany;
  readonly #selectByTrader;
  readonly #selectByDateRange;
  readonly #insert;
  readonly #update;
  readonly #deleteLeafTransactions;
  readonly #delete;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    this.#database = database;
    this.#currencies = currencies;
    this.#selectById = database.prepare<[number], PayoutRow>(SQL.selectById);
    this.#selectByCode = database.prepare<[string], PayoutRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], PayoutRow>(SQL.selectAll);
    this.#selectByCompany = database.prepare<[number], PayoutRow>(
      SQL.selectByCompany,
    );
    this.#selectByTrader = database.prepare<[number], PayoutRow>(
      SQL.selectByTrader,
    );
    this.#selectByDateRange = database.prepare<[string, string], PayoutRow>(
      SQL.selectByDateRange,
    );
    this.#insert = database.prepare<PayoutWrite>(SQL.insert);
    this.#update = database.prepare<PayoutWrite & { id: number }>(SQL.update);
    this.#deleteLeafTransactions = database.prepare<[number]>(
      SQL.deleteLeafTransactions,
    );
    this.#delete = database.prepare<[number]>(SQL.delete);
  }

  async findById(id: PayoutId): Promise<Payout | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : this.#map(row));
  }

  async findByCode(code: string): Promise<Payout | null> {
    const row = this.#selectByCode.get(code);
    return Promise.resolve(row === undefined ? null : this.#map(row));
  }

  async list(): Promise<readonly Payout[]> {
    return Promise.resolve(this.#selectAll.all().map((row) => this.#map(row)));
  }

  async listByCompany(companyId: CompanyId): Promise<readonly Payout[]> {
    return Promise.resolve(
      this.#selectByCompany.all(companyId).map((row) => this.#map(row)),
    );
  }

  async listByTrader(traderId: TraderId): Promise<readonly Payout[]> {
    return Promise.resolve(
      this.#selectByTrader.all(traderId).map((row) => this.#map(row)),
    );
  }

  async listByDateRange(range: DateRange): Promise<readonly Payout[]> {
    return Promise.resolve(
      this.#selectByDateRange
        .all(range.from, range.to)
        .map((row) => this.#map(row)),
    );
  }

  async insert(draft: PayoutDraft): Promise<Payout> {
    const result = this.#insert.run(SqlitePayoutRepository.#toWrite(draft));
    return this.#require(Number(result.lastInsertRowid));
  }

  async update(payout: Payout): Promise<Payout> {
    this.#update.run({
      ...SqlitePayoutRepository.#toWrite(payout),
      id: payout.id,
    });
    return this.#require(payout.id);
  }

  /**
   * The payout, its legs, their fees and the links to both — one unit of work.
   *
   * Wrapped in `database.transaction` because the first statement runs
   * several times: half a peeled tree is a set of legs belonging to a payout
   * that still exists, which no view and no check would report as wrong. The
   * fees and the `document_links` rows need no statement of their own — both
   * cascade from the row they hang on, and the documents themselves stay
   * (F6: one file can be evidence for several things).
   */
  async delete(id: PayoutId): Promise<void> {
    const remove = this.#database.transaction((payoutId: number) => {
      // Bounded by the depth of the tree, not by a hope: each pass removes
      // every current leaf, so a pass that removes nothing means nothing is
      // left to remove.
      for (;;) {
        const { changes } = this.#deleteLeafTransactions.run(payoutId);
        if (changes === 0) break;
      }

      this.#delete.run(payoutId);
    });

    remove(id);
    return Promise.resolve();
  }

  static #toWrite(payout: PayoutDraft | Payout): PayoutWrite {
    // One currency_code column covers both gross_amount and charges. If the
    // two Money values disagree, storing them would silently relabel the
    // charge — so refuse rather than write a number that means nothing.
    if (payout.gross.currency.code !== payout.charges.currency.code) {
      throw new Error(
        `Payout '${payout.code}' has gross in ${payout.gross.currency.code} but charges in ${payout.charges.currency.code}; the schema stores one currency for both.`,
      );
    }

    return {
      code: payout.code,
      companyId: payout.companyId,
      traderId: payout.traderId,
      payoutDate: payout.payoutDate,
      reference: payout.reference,
      gross: payout.gross.minor,
      charges: payout.charges.minor,
      currencyCode: payout.gross.currency.code,
      notes: payout.notes,
    };
  }

  #map(row: PayoutRow): Payout {
    return toPayout(row, this.#currencies);
  }

  async #require(id: PayoutId): Promise<Payout> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`payouts row ${String(id)} vanished after writing it`);
    }
    return Promise.resolve(this.#map(row));
  }
}
