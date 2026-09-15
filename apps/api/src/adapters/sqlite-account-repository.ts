import type {
  Account,
  AccountDraft,
  AccountId,
  AccountRepository,
  AccountType,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toAccount, type AccountRow } from './mappers';

const ACCOUNT_COLUMNS = 'id, code, name, type, company_id';

const SQL = {
  selectById: `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`,
  selectByCode: `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE code = ?`,
  selectAll: `SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY id`,
  selectByType: `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE type = ? ORDER BY id`,
  insert:
    'INSERT INTO accounts (code, name, type, company_id) VALUES (@code, @name, @type, @companyId)',
  update:
    'UPDATE accounts SET code = @code, name = @name, type = @type, company_id = @companyId WHERE id = @id',
  // account_currencies is WITHOUT ROWID, so there is no rowid to order by.
  selectCurrencies:
    'SELECT account_id, currency_code FROM account_currencies ORDER BY account_id, currency_code',
  selectCurrenciesFor:
    'SELECT currency_code FROM account_currencies WHERE account_id = ? ORDER BY currency_code',
  insertCurrency:
    'INSERT OR IGNORE INTO account_currencies (account_id, currency_code) VALUES (?, ?)',
  deleteCurrencies: 'DELETE FROM account_currencies WHERE account_id = ?',
  delete: 'DELETE FROM accounts WHERE id = ?',
} as const;

interface CurrencyRow {
  readonly account_id: bigint;
  readonly currency_code: string;
}

/**
 * The allow-list lives in `account_currencies`, not on the account row, so
 * every read here is two queries rather than one join — a join would multiply
 * the account row by its currencies and need regrouping anyway. The list is
 * fetched in bulk for `list`/`listByType` so the cost stays two queries no
 * matter how many accounts come back.
 *
 * `default_currency_code` and `is_mine` are columns the domain does not model.
 * They keep their schema defaults; nothing here writes them.
 */
export class SqliteAccountRepository implements AccountRepository {
  readonly #database: SqliteDatabase;
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #selectByType;
  readonly #insert;
  readonly #update;
  readonly #selectCurrencies;
  readonly #selectCurrenciesFor;
  readonly #insertCurrency;
  readonly #deleteCurrencies;
  readonly #delete;

  constructor(database: SqliteDatabase) {
    this.#database = database;
    this.#selectById = database.prepare<[number], AccountRow>(SQL.selectById);
    this.#selectByCode = database.prepare<[string], AccountRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], AccountRow>(SQL.selectAll);
    this.#selectByType = database.prepare<[string], AccountRow>(
      SQL.selectByType,
    );
    this.#insert = database.prepare<{
      code: string;
      name: string;
      type: string;
      companyId: number | null;
    }>(SQL.insert);
    this.#update = database.prepare<{
      id: number;
      code: string;
      name: string;
      type: string;
      companyId: number | null;
    }>(SQL.update);
    this.#selectCurrencies = database.prepare<[], CurrencyRow>(
      SQL.selectCurrencies,
    );
    this.#selectCurrenciesFor = database.prepare<
      [number],
      { currency_code: string }
    >(SQL.selectCurrenciesFor);
    this.#insertCurrency = database.prepare<[number, string]>(
      SQL.insertCurrency,
    );
    this.#deleteCurrencies = database.prepare<[number]>(SQL.deleteCurrencies);
    this.#delete = database.prepare<[number]>(SQL.delete);
  }

  async findById(id: AccountId): Promise<Account | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : this.#hydrate(row));
  }

  async findByCode(code: string): Promise<Account | null> {
    const row = this.#selectByCode.get(code);
    return Promise.resolve(row === undefined ? null : this.#hydrate(row));
  }

  async list(): Promise<readonly Account[]> {
    return Promise.resolve(this.#hydrateAll(this.#selectAll.all()));
  }

  async listByType(type: AccountType): Promise<readonly Account[]> {
    return Promise.resolve(this.#hydrateAll(this.#selectByType.all(type)));
  }

  async insert(draft: AccountDraft): Promise<Account> {
    const write = this.#database.transaction(() => {
      const result = this.#insert.run({
        code: draft.code,
        name: draft.name,
        type: draft.type,
        companyId: draft.companyId,
      });

      const id = Number(result.lastInsertRowid);
      for (const code of draft.allowedCurrencies) {
        this.#insertCurrency.run(id, code);
      }
      return id;
    });

    return this.#require(write());
  }

  async update(account: Account): Promise<Account> {
    const write = this.#database.transaction(() => {
      this.#update.run({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        companyId: account.companyId,
      });

      this.#deleteCurrencies.run(account.id);
      for (const code of account.allowedCurrencies) {
        this.#insertCurrency.run(account.id, code);
      }
    });

    write();
    return this.#require(account.id);
  }

  /**
   * The account and the configuration that only exists for it.
   *
   * `account_currencies`, `account_identifiers` and `fee_schedules` all
   * cascade from the row — an allow-list, an address book and a 0.5% schedule
   * belonging to an exchange that is gone are three kinds of orphan. The
   * transactions do not cascade and must not: both `from_account_id` and
   * `to_account_id` are ON DELETE RESTRICT, so an account with any history
   * fails here rather than taking the ledger with it. `DeleteAccount` says so
   * in a sentence before it gets this far; this is the guarantee behind it.
   */
  async delete(id: AccountId): Promise<void> {
    this.#delete.run(id);
    return Promise.resolve();
  }

  #hydrate(row: AccountRow): Account {
    const codes = this.#selectCurrenciesFor
      .all(Number(row.id))
      .map((entry) => entry.currency_code);
    return toAccount(row, codes);
  }

  #hydrateAll(rows: readonly AccountRow[]): readonly Account[] {
    const byAccount = new Map<number, string[]>();
    for (const entry of this.#selectCurrencies.all()) {
      const key = Number(entry.account_id);
      const bucket = byAccount.get(key) ?? [];
      bucket.push(entry.currency_code);
      byAccount.set(key, bucket);
    }

    return rows.map((row) =>
      toAccount(row, byAccount.get(Number(row.id)) ?? []),
    );
  }

  async #require(id: AccountId): Promise<Account> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`accounts row ${String(id)} vanished after writing it`);
    }
    return Promise.resolve(this.#hydrate(row));
  }
}
