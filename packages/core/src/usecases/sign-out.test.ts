import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  TestWorld,
} from '../../test/fakes/world';

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

  const useCase = new SignOut({ sessions: world.sessions, clock: world.clock });

  const open = () =>
    signIn.execute({
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
    });

  return { world, useCase, open };
};

describe('SignOut (UC14)', () => {
  it('revokes the session server-side, not just in the browser', async () => {
    const { world, useCase, open } = setup();
    const { session } = await open();

    await useCase.execute({ sessionId: session.id });

    const stored = await world.sessions.findById(session.id);
    expect(stored?.isRevoked()).toBe(true);
  });

  it('stamps the revocation with the injected clock', async () => {
    const { world, useCase, open } = setup();
    const { session } = await open();

    world.clock.set('2025-04-01T09:00:00.000Z');
    await useCase.execute({ sessionId: session.id });

    expect((await world.sessions.findById(session.id))?.revokedAt).toBe(
      '2025-04-01T09:00:00.000Z',
    );
  });

  describe('idempotence', () => {
    it('signing out twice is not an error', async () => {
      const { useCase, open } = setup();
      const { session } = await open();

      await expect(useCase.execute({ sessionId: session.id })).resolves.toEqual(
        { revoked: true },
      );
      await expect(useCase.execute({ sessionId: session.id })).resolves.toEqual(
        { revoked: false },
      );
    });

    it('keeps the first revocation stamp on a second call', async () => {
      const { world, useCase, open } = setup();
      const { session } = await open();

      await useCase.execute({ sessionId: session.id });
      world.clock.advanceSeconds(3600);
      await useCase.execute({ sessionId: session.id });

      expect((await world.sessions.findById(session.id))?.revokedAt).toBe(
        '2025-03-16T10:30:00.000Z',
      );
    });

    it('accepts a session id that never existed, silently', async () => {
      // An unauthenticated endpoint that said "no such session" would be a
      // free oracle for guessing session ids.
      const { useCase } = setup();

      await expect(
        useCase.execute({ sessionId: 'never-issued' }),
      ).resolves.toEqual({ revoked: false });
    });

    it('reports the same thing for a forged id as for a used-up one', async () => {
      const { useCase, open } = setup();
      const { session } = await open();
      await useCase.execute({ sessionId: session.id });

      const usedUp = await useCase.execute({ sessionId: session.id });
      const forged = await useCase.execute({ sessionId: 'forged' });

      expect(usedUp).toEqual(forged);
    });
  });

  it('leaves other sessions alone', async () => {
    const { world, useCase, open } = setup();
    const first = await open();
    const second = await open();

    await useCase.execute({ sessionId: first.session.id });

    expect(
      (await world.sessions.findById(second.session.id))?.isRevoked(),
    ).toBe(false);
  });
});
