import type {
  CompanyId,
  CurrencyRegistry,
  DateRange,
  Payout,
  PayoutDraft,
  PayoutId,
  PayoutRepository,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toPayout, type PayoutRow } from './mappers';

const PAYOUT_COLUMNS =
  'id, code, company_id, payout_date, reference, gross_amount, charges, currency_code, notes';

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
  selectByDateRange: `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE payout_date >= ? AND payout_date <= ? ORDER BY payout_date, id`,
  insert: `INSERT INTO payouts
             (code, company_id, payout_date, reference, gross_amount, charges, currency_code, notes)
           VALUES
             (@code, @companyId, @payoutDate, @reference, @gross, @charges, @currencyCode, @notes)`,
  update: `UPDATE payouts SET
             code = @code, company_id = @companyId, payout_date = @payoutDate,
             reference = @reference, gross_amount = @gross, charges = @charges,
             currency_code = @currencyCode, notes = @notes
           WHERE id = @id`,
} as const;

interface PayoutWrite {
  readonly code: string;
  readonly companyId: number;
  readonly payoutDate: string;
  readonly reference: string | null;
  readonly gross: bigint;
  readonly charges: bigint;
  readonly currencyCode: string;
  readonly notes: string | null;
}

export class SqlitePayoutRepository implements PayoutRepository {
  readonly #currencies: CurrencyRegistry;
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #selectByCompany;
  readonly #selectByDateRange;
  readonly #insert;
  readonly #update;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    this.#currencies = currencies;
    this.#selectById = database.prepare<[number], PayoutRow>(SQL.selectById);
    this.#selectByCode = database.prepare<[string], PayoutRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], PayoutRow>(SQL.selectAll);
    this.#selectByCompany = database.prepare<[number], PayoutRow>(
      SQL.selectByCompany,
    );
    this.#selectByDateRange = database.prepare<[string, string], PayoutRow>(
      SQL.selectByDateRange,
    );
    this.#insert = database.prepare<PayoutWrite>(SQL.insert);
    this.#update = database.prepare<PayoutWrite & { id: number }>(SQL.update);
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
