import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  TestWorld,
} from '../../test/fakes/world';
import { SessionInvalidError } from '../domain/errors';
import { SESSION_LIFETIME_MS } from '../domain/session';

import { AuthenticateSession } from './authenticate-session';
import { SignIn } from './sign-in';
import { SignOut } from './sign-out';

const setup = () => {
  const world = new TestWorld();

  const signIn = new SignIn({
    users: world.users,
    sessions: world.sessions,
    hasher: world.hasher,
    ids: world.ids,
    clock: world.clock,
  });

  const useCase = new AuthenticateSession({
    sessions: world.sessions,
    users: world.users,
    clock: world.clock,
  });

  const signOut = new SignOut({ sessions: world.sessions, clock: world.clock });

  const open = () =>
    signIn.execute({
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
    });

  return { world, useCase, signOut, open };
};

describe('AuthenticateSession (UC12)', () => {
  it('returns the user behind a live session', async () => {
    const { useCase, open } = setup();
    const { session } = await open();

    const result = await useCase.execute({ sessionId: session.id });

    expect(result.user.username).toBe('admin');
    expect(result.session.id).toBe(session.id);
  });

  describe('rejection', () => {
    it('rejects a forged id', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ sessionId: 'not-a-real-session-id' }),
      ).rejects.toMatchObject({
        name: 'SessionInvalidError',
        reason: 'unknown',
      });
    });

    it('rejects an expired session', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 1000 + 1);

      await expect(
        useCase.execute({ sessionId: session.id }),
      ).rejects.toMatchObject({ reason: 'expired' });
    });

    it('rejects a revoked session even while it is still in date', async () => {
      const { useCase, signOut, open } = setup();
      const { session } = await open();

      await signOut.execute({ sessionId: session.id });

      await expect(
        useCase.execute({ sessionId: session.id }),
      ).rejects.toMatchObject({ reason: 'revoked' });
    });

    it('says revoked, not expired, when a session is both', async () => {
      // The deliberate act is the informative one.
      const { world, useCase, signOut, open } = setup();
      const { session } = await open();

      await signOut.execute({ sessionId: session.id });
      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 1000 + 1);

      await expect(
        useCase.execute({ sessionId: session.id }),
      ).rejects.toMatchObject({ reason: 'revoked' });
    });

    it('always throws the one error type, whatever went wrong', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ sessionId: 'nope' }),
      ).rejects.toBeInstanceOf(SessionInvalidError);
    });

    it('rejects an empty session id without a lookup surprise', async () => {
      const { useCase } = setup();

      await expect(useCase.execute({ sessionId: '' })).rejects.toBeInstanceOf(
        SessionInvalidError,
      );
    });
  });

  describe('extension', () => {
    it('leaves a young session alone', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(60);
      const result = await useCase.execute({ sessionId: session.id });

      expect(result.extended).toBe(false);
      expect(result.session.expiresAt).toBe(session.expiresAt);
    });

    it('extends a session past the halfway mark', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 2000 + 1);
      const result = await useCase.execute({ sessionId: session.id });

      expect(result.extended).toBe(true);
      expect(Date.parse(result.session.expiresAt)).toBeGreaterThan(
        Date.parse(session.expiresAt),
      );
    });

    it('persists the extension, rather than only returning it', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 2000 + 1);
      const result = await useCase.execute({ sessionId: session.id });

      const stored = await world.sessions.findById(session.id);
      expect(stored?.expiresAt).toBe(result.session.expiresAt);
    });

    it('keeps the same id, so the cookie does not need reissuing', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 2000 + 1);
      const result = await useCase.execute({ sessionId: session.id });

      expect(result.session.id).toBe(session.id);
    });

    it('never extends a session back from the dead', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      world.clock.advanceSeconds(SESSION_LIFETIME_MS / 1000 + 1);

      await expect(
        useCase.execute({ sessionId: session.id }),
      ).rejects.toThrow();
      const stored = await world.sessions.findById(session.id);
      expect(stored?.expiresAt).toBe(session.expiresAt);
    });
  });

  it('carries the must-change flag through, since the guard needs it', async () => {
    const { useCase, open } = setup();
    const { session } = await open();

    const result = await useCase.execute({ sessionId: session.id });

    expect(result.user.mustChangePassword).toBe(true);
  });
});
