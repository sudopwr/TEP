import type {
  Trader,
  TraderDraft,
  TraderId,
  TraderRepository,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toTrader, type TraderRow } from './mappers';

/**
 * The people whose payouts these are (F24, `004_traders.sql`).
 *
 * Shaped like the company repository next door, because a trader is the same
 * kind of thing to the database: a small row nothing computes, pointed at by
 * the rows that matter. It is emphatically *not* shaped like the user
 * repository, which carries a credential.
 *
 * Statements are built per connection, not at module level, for the reason
 * `SqliteCompanyRepository` sets out at length.
 */
const SQL = {
  selectById: 'SELECT id, code, name, notes FROM traders WHERE id = ?',
  selectByCode: 'SELECT id, code, name, notes FROM traders WHERE code = ?',
  /** By name, because this list is a picker rather than a history. */
  selectAll: 'SELECT id, code, name, notes FROM traders ORDER BY name, id',
  insert:
    'INSERT INTO traders (code, name, notes) VALUES (@code, @name, @notes)',
  update:
    'UPDATE traders SET code = @code, name = @name, notes = @notes WHERE id = @id',
} as const;

interface TraderWrite {
  readonly code: string;
  readonly name: string;
  readonly notes: string | null;
}

export class SqliteTraderRepository implements TraderRepository {
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #insert;
  readonly #update;

  constructor(database: SqliteDatabase) {
    this.#selectById = database.prepare<[number], TraderRow>(SQL.selectById);
    this.#selectByCode = database.prepare<[string], TraderRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], TraderRow>(SQL.selectAll);
    this.#insert = database.prepare<TraderWrite>(SQL.insert);
    this.#update = database.prepare<TraderWrite & { id: number }>(SQL.update);
  }

  async findById(id: TraderId): Promise<Trader | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : toTrader(row));
  }

  async findByCode(code: string): Promise<Trader | null> {
    const row = this.#selectByCode.get(code);
    return Promise.resolve(row === undefined ? null : toTrader(row));
  }

  async list(): Promise<readonly Trader[]> {
    return Promise.resolve(this.#selectAll.all().map((row) => toTrader(row)));
  }

  async insert(draft: TraderDraft): Promise<Trader> {
    const result = this.#insert.run({
      code: draft.code,
      name: draft.name,
      notes: draft.notes,
    });

    return this.#require(Number(result.lastInsertRowid));
  }

  async update(trader: Trader): Promise<Trader> {
    this.#update.run({
      id: trader.id,
      code: trader.code,
      name: trader.name,
      notes: trader.notes,
    });

    return this.#require(trader.id);
  }

  async #require(id: TraderId): Promise<Trader> {
    const row = this.#selectById.get(id);

    if (row === undefined) {
      throw new Error(`Trader ${String(id)} vanished between write and read.`);
    }

    return Promise.resolve(toTrader(row));
  }
}
