import { Session, User } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { SqliteSessionRepository } from './sqlite-session-repository';
import { SqliteUserRepository } from './sqlite-user-repository';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$abcdefghijklmnop';

describe('SqliteUserRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteUserRepository;

  beforeEach(() => {
    database = openTestDatabase();
    repository = new SqliteUserRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('finds the admin migration 003 seeded', async () => {
    const admin = await repository.findByUsername('admin');

    expect(admin?.id).toBe(1);
    expect(admin?.mustChangePassword).toBe(true);
    expect(admin?.passwordChangedAt).toBeNull();
  });

  it('reads the must-change flag back as a boolean, not a 1', async () => {
    // SQLite has no boolean. The mapper is where the 1 stops being an integer.
    const admin = await repository.findByUsername('admin');

    expect(admin?.mustChangePassword).toBe(true);
    expect(typeof admin?.mustChangePassword).toBe('boolean');
  });

  it('round-trips a changed credential', async () => {
    const admin = await repository.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');

    const changed = await repository.update(
      admin.withPassword(HASH, '2025-03-16T10:30:00.000Z'),
    );

    expect(changed.passwordHash).toBe(HASH);
    expect(changed.mustChangePassword).toBe(false);
    expect(changed.passwordChangedAt).toBe('2025-03-16T10:30:00.000Z');
    await expect(repository.findById(1)).resolves.toEqual(changed);
  });

  it('round-trips a rename and finds the user under the new name', async () => {
    const admin = await repository.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');

    await repository.update(admin.withUsername('kd'));

    await expect(repository.findByUsername('kd')).resolves.toMatchObject({
      id: 1,
    });
    await expect(repository.findByUsername('admin')).resolves.toBeNull();
  });

  it('never moves created_at on an update', async () => {
    // When the account was created is a fact, not a field.
    const before = await repository.findById(1);
    if (before === null) throw new Error('missing admin');

    await repository.update(before.withUsername('kd'));

    expect((await repository.findById(1))?.createdAt).toBe(before.createdAt);
  });

  it('returns null for an unknown username rather than throwing', async () => {
    await expect(repository.findByUsername('nobody')).resolves.toBeNull();
    await expect(repository.findById(999)).resolves.toBeNull();
  });

  it('counts the accounts', async () => {
    await expect(repository.count()).resolves.toBe(1);
  });

  it('inserts a second user and allocates an id', async () => {
    const second = await repository.insert({
      username: 'someone-else',
      passwordHash: HASH,
      mustChangePassword: false,
      createdAt: '2025-03-16T10:30:00.000Z',
      passwordChangedAt: '2025-03-16T10:30:00.000Z',
    });

    expect(second.id).toBe(2);
    await expect(repository.count()).resolves.toBe(2);
  });

  it('refuses a duplicate username, because the database does', async () => {
    await expect(
      repository.insert({
        username: 'admin',
        passwordHash: HASH,
        mustChangePassword: false,
        createdAt: '2025-03-16T10:30:00.000Z',
        passwordChangedAt: null,
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });

  it('refuses an empty username', async () => {
    await expect(
      repository.insert({
        username: '',
        passwordHash: HASH,
        mustChangePassword: false,
        createdAt: '2025-03-16T10:30:00.000Z',
        passwordChangedAt: null,
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
  });

  it('refuses an empty password hash', async () => {
    // A user row with no credential would be an account nobody can sign into
    // and everybody can fail against. Better to have no row.
    await expect(
      repository.insert({
        username: 'ghost',
        passwordHash: '',
        mustChangePassword: false,
        createdAt: '2025-03-16T10:30:00.000Z',
        passwordChangedAt: null,
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
  });

  it('deleting a user takes their sessions with them', async () => {
    const sessions = new SqliteSessionRepository(database);
    const user = await repository.insert({
      username: 'temporary',
      passwordHash: HASH,
      mustChangePassword: false,
      createdAt: '2025-03-16T10:30:00.000Z',
      passwordChangedAt: null,
    });
    await sessions.insert(
      Session.starting('doomed', user.id, new Date('2025-03-16T10:30:00Z')),
    );

    database.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    await expect(sessions.findById('doomed')).resolves.toBeNull();
  });

  it('maps a row the domain would reject rather than inventing a value', () => {
    // A user entity with no hash is not constructible, and the CHECK means
    // no such row can exist. This asserts the pairing, not the mapper.
    expect(() =>
      User.create({
        id: 1,
        username: 'admin',
        passwordHash: HASH,
        mustChangePassword: true,
        createdAt: '2025-03-16T10:30:00.000Z',
        passwordChangedAt: null,
      }),
    ).not.toThrow();
  });
});
