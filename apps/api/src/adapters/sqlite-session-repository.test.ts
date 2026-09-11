import { Session } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { SqliteSessionRepository } from './sqlite-session-repository';

const START = new Date('2025-03-16T10:30:00.000Z');

describe('SqliteSessionRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteSessionRepository;

  beforeEach(() => {
    database = openTestDatabase();
    repository = new SqliteSessionRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  const open = (id: string, at: Date = START, userId = 1) =>
    repository.insert(Session.starting(id, userId, at));

  it('round-trips a session', async () => {
    const session = await open('sess-a');

    await expect(repository.findById('sess-a')).resolves.toEqual(session);
  });

  it('keeps the id as TEXT, untouched', async () => {
    // A base64url id contains - and _ and must survive storage verbatim.
    const id = 'Zm9vYmFyLWJheg_QUJDRA-1234567890abcdef';
    await open(id);

    await expect(repository.findById(id)).resolves.toMatchObject({ id });
  });

  it('returns null for an id that was never issued', async () => {
    await expect(repository.findById('forged')).resolves.toBeNull();
  });

  it('returns null for the empty string without a lookup surprise', async () => {
    await expect(repository.findById('')).resolves.toBeNull();
  });

  it('returns an expired session rather than hiding it', async () => {
    // Deciding what an unusable session means is UC12's job. Storage that
    // silently filtered would make "expired" and "forged" indistinguishable,
    // and UC12 could no longer report the right reason.
    const old = Session.create({
      id: 'stale',
      userId: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-01-31T00:00:00.000Z',
      revokedAt: null,
    });
    await repository.insert(old);

    const found = await repository.findById('stale');
    expect(found?.isExpired(START)).toBe(true);
  });

  describe('constraints the database enforces', () => {
    it('refuses two sessions with the same id', async () => {
      await open('sess-a');

      await expect(open('sess-a')).rejects.toMatchObject({
        code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
      });
    });

    it('refuses a session for a user that does not exist', async () => {
      await expect(open('orphan', START, 999)).rejects.toMatchObject({
        code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
      });
    });

    it('refuses a session that expires before it was created', async () => {
      await expect(
        repository.insert(
          Session.create({
            id: 'backwards',
            userId: 1,
            createdAt: '2025-03-16T10:30:00.000Z',
            expiresAt: '2025-03-01T10:30:00.000Z',
            revokedAt: null,
          }),
        ),
      ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    });
  });

  describe('update', () => {
    it('persists an extension', async () => {
      const session = await open('sess-a');
      const later = new Date('2025-04-01T10:30:00.000Z');

      await repository.update(session.extendedFrom(later));

      expect((await repository.findById('sess-a'))?.expiresAt).toBe(
        '2025-05-01T10:30:00.000Z',
      );
    });

    it('persists a revocation', async () => {
      const session = await open('sess-a');

      await repository.update(session.revoked(START));

      expect((await repository.findById('sess-a'))?.isRevoked()).toBe(true);
    });

    it('will not move created_at, even when asked', async () => {
      const session = await open('sess-a');

      await repository.update(
        Session.create({
          id: 'sess-a',
          userId: 1,
          createdAt: '1999-01-01T00:00:00.000Z',
          expiresAt: session.expiresAt,
          revokedAt: null,
        }),
      );

      expect((await repository.findById('sess-a'))?.createdAt).toBe(
        session.createdAt,
      );
    });
  });

  describe('listForUser', () => {
    it('returns every session, newest first', async () => {
      await open('older', new Date('2025-03-01T00:00:00.000Z'));
      await open('newer', new Date('2025-03-10T00:00:00.000Z'));

      const listed = await repository.listForUser(1);

      expect(listed.map((one) => one.id)).toEqual(['newer', 'older']);
    });

    it('includes revoked and expired rows', async () => {
      const session = await open('revoked');
      await repository.update(session.revoked(START));

      await expect(repository.listForUser(1)).resolves.toHaveLength(1);
    });

    it('returns an empty list for a user with no sessions', async () => {
      await expect(repository.listForUser(1)).resolves.toEqual([]);
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every live session', async () => {
      await open('a');
      await open('b');

      const revoked = await repository.revokeAllForUser(
        1,
        '2025-03-16T12:00:00.000Z',
      );

      expect(revoked).toBe(2);
      expect((await repository.findById('a'))?.revokedAt).toBe(
        '2025-03-16T12:00:00.000Z',
      );
    });

    it('spares the session it is told to spare', async () => {
      await open('keep');
      await open('sweep');

      const revoked = await repository.revokeAllForUser(
        1,
        '2025-03-16T12:00:00.000Z',
        'keep',
      );

      expect(revoked).toBe(1);
      expect((await repository.findById('keep'))?.isRevoked()).toBe(false);
      expect((await repository.findById('sweep'))?.isRevoked()).toBe(true);
    });

    it('sweeps everything when no exception is named', async () => {
      // `id <> NULL` is NULL in SQL, which would spare nothing — or, with the
      // comparison written the other way round, everything. The sentinel is
      // why this passes.
      await open('a');
      await open('b');

      await expect(
        repository.revokeAllForUser(1, '2025-03-16T12:00:00.000Z', undefined),
      ).resolves.toBe(2);
    });

    it('does not re-stamp an already revoked session', async () => {
      const session = await open('a');
      await repository.update(session.revoked(START));

      const revoked = await repository.revokeAllForUser(
        1,
        '2025-03-16T12:00:00.000Z',
      );

      expect(revoked).toBe(0);
      expect((await repository.findById('a'))?.revokedAt).toBe(
        '2025-03-16T10:30:00.000Z',
      );
    });
  });

  describe('deleteExpiredBefore', () => {
    it('drops rows that expired before the cutoff', async () => {
      await repository.insert(
        Session.create({
          id: 'stale',
          userId: 1,
          createdAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-31T00:00:00.000Z',
          revokedAt: null,
        }),
      );
      await open('live');

      const deleted = await repository.deleteExpiredBefore(
        '2025-01-01T00:00:00.000Z',
      );

      expect(deleted).toBe(1);
      await expect(repository.findById('live')).resolves.not.toBeNull();
    });
  });
});
