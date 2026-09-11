import { FeeSchedule as FeeScheduleEntity } from '@payout/core';
import type {
  AccountId,
  CurrencyRegistry,
  FeeSchedule,
  FeeScheduleDraft,
  FeeScheduleId,
  FeeScheduleRepository,
  IsoDate,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toFeeSchedule, type FeeScheduleRow } from './mappers';

const SCHEDULE_COLUMNS = `id, account_id, fee_type, basis, rate_bps,
  flat_amount, currency_code, effective_from, effective_to`;

const SQL = {
  selectById: `SELECT ${SCHEDULE_COLUMNS} FROM fee_schedules WHERE id = ?`,
  selectAll: `SELECT ${SCHEDULE_COLUMNS} FROM fee_schedules ORDER BY id`,
  /**
   * Effective on a date means inclusive at both ends, matching
   * `FeeSchedule.appliesOn`. The engine re-checks the date anyway, so the two
   * agreeing is a property worth keeping rather than an accident.
   */
  selectForAccountOn: `SELECT ${SCHEDULE_COLUMNS} FROM fee_schedules
                        WHERE account_id = @accountId
                          AND effective_from <= @date
                          AND (effective_to IS NULL OR effective_to >= @date)
                        ORDER BY id`,
  insert: `INSERT INTO fee_schedules
             (account_id, fee_type, basis, rate_bps, flat_amount, currency_code, effective_from, effective_to)
           VALUES
             (@accountId, @feeType, @basis, @rateBps, @flatAmount, @currencyCode, @effectiveFrom, @effectiveTo)`,
  update: `UPDATE fee_schedules SET
             account_id = @accountId, fee_type = @feeType, basis = @basis,
             rate_bps = @rateBps, flat_amount = @flatAmount, currency_code = @currencyCode,
             effective_from = @effectiveFrom, effective_to = @effectiveTo
           WHERE id = @id`,
} as const;

interface ScheduleWrite {
  readonly accountId: number;
  readonly feeType: string;
  readonly basis: string;
  readonly rateBps: number | null;
  readonly flatAmount: bigint | null;
  readonly currencyCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export class SqliteFeeScheduleRepository implements FeeScheduleRepository {
  readonly #currencies: CurrencyRegistry;
  readonly #selectById;
  readonly #selectAll;
  readonly #selectForAccountOn;
  readonly #insert;
  readonly #update;

  constructor(database: SqliteDatabase, currencies: CurrencyRegistry) {
    this.#currencies = currencies;
    this.#selectById = database.prepare<[number], FeeScheduleRow>(
      SQL.selectById,
    );
    this.#selectAll = database.prepare<[], FeeScheduleRow>(SQL.selectAll);
    this.#selectForAccountOn = database.prepare<
      { accountId: number; date: string },
      FeeScheduleRow
    >(SQL.selectForAccountOn);
    this.#insert = database.prepare<ScheduleWrite>(SQL.insert);
    this.#update = database.prepare<ScheduleWrite & { id: number }>(SQL.update);
  }

  async findById(id: FeeScheduleId): Promise<FeeSchedule | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : this.#map(row));
  }

  async list(): Promise<readonly FeeSchedule[]> {
    return Promise.resolve(this.#selectAll.all().map((row) => this.#map(row)));
  }

  async listForAccountOn(
    accountId: AccountId,
    date: IsoDate,
  ): Promise<readonly FeeSchedule[]> {
    return Promise.resolve(
      this.#selectForAccountOn
        .all({ accountId, date })
        .map((row) => this.#map(row)),
    );
  }

  async insert(draft: FeeScheduleDraft): Promise<FeeSchedule> {
    // Validate before writing, so a flat schedule with no amount fails as an
    // InvalidFeeScheduleError rather than as a CHECK constraint.
    FeeScheduleEntity.create({ ...draft, id: 0 });

    const result = this.#insert.run(
      SqliteFeeScheduleRepository.#toWrite(draft),
    );
    return this.#require(Number(result.lastInsertRowid));
  }

  async update(schedule: FeeSchedule): Promise<FeeSchedule> {
    this.#update.run({
      ...SqliteFeeScheduleRepository.#toWrite(schedule),
      id: schedule.id,
    });
    return this.#require(schedule.id);
  }

  static #toWrite(schedule: FeeScheduleDraft | FeeSchedule): ScheduleWrite {
    return {
      accountId: schedule.accountId,
      feeType: schedule.feeType,
      basis: schedule.basis,
      rateBps: schedule.rateBps,
      flatAmount: schedule.flatAmount?.minor ?? null,
      currencyCode: schedule.flatAmount?.currency.code ?? null,
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
    };
  }

  #map(row: FeeScheduleRow): FeeSchedule {
    return toFeeSchedule(row, this.#currencies);
  }

  async #require(id: FeeScheduleId): Promise<FeeSchedule> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(
        `fee_schedules row ${String(id)} vanished after writing it`,
      );
    }
    return Promise.resolve(this.#map(row));
  }
}
