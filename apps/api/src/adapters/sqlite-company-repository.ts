import type {
  Company,
  CompanyDraft,
  CompanyId,
  CompanyRepository,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toCompany, type CompanyRow } from './mappers';

/**
 * SQL lives at module level; the statements compiled from it are built once
 * per connection in the constructor and reused for every call after that.
 *
 * CLAUDE.md §12 asks for statements built once at module level. A prepared
 * statement belongs to the connection that compiled it, and the tests open a
 * fresh `:memory:` database per case, so a module-level statement would bind
 * to whichever database happened to load the module first. Constructing them
 * once per repository instance — which is once per connection — is the same
 * guarantee the convention is reaching for, and the only version of it that
 * survives more than one database.
 */
const SQL = {
  selectById: 'SELECT id, code, name, notes FROM companies WHERE id = ?',
  selectByCode: 'SELECT id, code, name, notes FROM companies WHERE code = ?',
  selectAll: 'SELECT id, code, name, notes FROM companies ORDER BY id',
  insert:
    'INSERT INTO companies (code, name, notes) VALUES (@code, @name, @notes)',
  update:
    'UPDATE companies SET code = @code, name = @name, notes = @notes WHERE id = @id',
} as const;

export class SqliteCompanyRepository implements CompanyRepository {
  readonly #selectById;
  readonly #selectByCode;
  readonly #selectAll;
  readonly #insert;
  readonly #update;

  constructor(database: SqliteDatabase) {
    this.#selectById = database.prepare<[number], CompanyRow>(SQL.selectById);
    this.#selectByCode = database.prepare<[string], CompanyRow>(
      SQL.selectByCode,
    );
    this.#selectAll = database.prepare<[], CompanyRow>(SQL.selectAll);
    this.#insert = database.prepare<{
      code: string;
      name: string;
      notes: string | null;
    }>(SQL.insert);
    this.#update = database.prepare<{
      id: number;
      code: string;
      name: string;
      notes: string | null;
    }>(SQL.update);
  }

  async findById(id: CompanyId): Promise<Company | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : toCompany(row));
  }

  async findByCode(code: string): Promise<Company | null> {
    const row = this.#selectByCode.get(code);
    return Promise.resolve(row === undefined ? null : toCompany(row));
  }

  async list(): Promise<readonly Company[]> {
    return Promise.resolve(this.#selectAll.all().map(toCompany));
  }

  async insert(draft: CompanyDraft): Promise<Company> {
    const result = this.#insert.run({
      code: draft.code,
      name: draft.name,
      notes: draft.notes,
    });

    return this.#require(Number(result.lastInsertRowid));
  }

  async update(company: Company): Promise<Company> {
    this.#update.run({
      id: company.id,
      code: company.code,
      name: company.name,
      notes: company.notes,
    });

    return this.#require(company.id);
  }

  /** Read back what the database actually stored, defaults included. */
  async #require(id: CompanyId): Promise<Company> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`companies row ${String(id)} vanished after writing it`);
    }
    return Promise.resolve(toCompany(row));
  }
}
