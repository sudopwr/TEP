import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { SqliteCompanyRepository } from './sqlite-company-repository';

describe('SqliteCompanyRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteCompanyRepository;

  beforeEach(() => {
    database = openTestDatabase();
    repository = new SqliteCompanyRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  const draft = (code = 'Tradeify001') => ({
    code,
    name: 'Tradeify',
    notes: null,
  });

  it('inserts and hands back the id the database allocated', async () => {
    const company = await repository.insert(draft());

    expect(company.id).toBe(1);
    expect(company.code).toBe('Tradeify001');
  });

  it('allocates increasing ids', async () => {
    const first = await repository.insert(draft('A'));
    const second = await repository.insert(draft('B'));

    expect(second.id).toBe(first.id + 1);
  });

  it('round-trips through findById', async () => {
    const inserted = await repository.insert(draft());

    await expect(repository.findById(inserted.id)).resolves.toEqual(inserted);
  });

  it('finds by code', async () => {
    await repository.insert(draft());

    const found = await repository.findByCode('Tradeify001');

    expect(found?.name).toBe('Tradeify');
  });

  it('returns null rather than throwing for a missing row', async () => {
    await expect(repository.findById(99)).resolves.toBeNull();
    await expect(repository.findByCode('nope')).resolves.toBeNull();
  });

  it('lists in id order', async () => {
    await repository.insert(draft('B'));
    await repository.insert(draft('A'));

    const codes = (await repository.list()).map((one) => one.code);

    expect(codes).toEqual(['B', 'A']);
  });

  it('persists an update and leaves the id alone', async () => {
    const company = await repository.insert(draft());

    const renamed = await repository.update(
      company.rename('Tradeify LLC').withNotes('pays via Rise'),
    );

    expect(renamed.id).toBe(company.id);
    expect(renamed.name).toBe('Tradeify LLC');
    await expect(repository.findById(company.id)).resolves.toEqual(renamed);
  });

  it('refuses a duplicate code, because the column is unique', async () => {
    await repository.insert(draft());

    await expect(repository.insert(draft())).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
  });

  it('starts empty', async () => {
    await expect(repository.list()).resolves.toEqual([]);
  });
});
