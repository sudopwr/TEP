import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  TestWorld,
} from '../../test/fakes/world';
import { rejection } from '../../test/rejection';
import { AuthenticationFailedError } from '../domain/errors';

import { SignIn } from './sign-in';

const setup = () => {
  const world = new TestWorld();
  const useCase = new SignIn({
    users: world.users,
    sessions: world.sessions,
    hasher: world.hasher,
    ids: world.ids,
    clock: world.clock,
  });

  return { world, useCase };
};

const asAdmin = {
  username: DEFAULT_ADMIN_USERNAME,
  password: DEFAULT_ADMIN_PASSWORD,
};

describe('SignIn (UC11)', () => {
  it('signs in the shipped admin and says the password must change', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(asAdmin);

    expect(result.user.username).toBe('admin');
    expect(result.mustChangePassword).toBe(true);
  });

  it('opens a session that runs for thirty days from now', async () => {
    const { world, useCase } = setup();
    world.clock.set('2025-03-16T10:30:00.000Z');

    const { session } = await useCase.execute(asAdmin);

    expect(session.createdAt).toBe('2025-03-16T10:30:00.000Z');
    expect(session.expiresAt).toBe('2025-04-15T10:30:00.000Z');
    expect(session.isActive(world.clock.now())).toBe(true);
  });

  it('persists the session rather than only returning it', async () => {
    const { world, useCase } = setup();

    const { session } = await useCase.execute(asAdmin);

    const stored = await world.sessions.findById(session.id);
    expect(stored?.userId).toBe(session.userId);
  });

  it('takes the session id from the injected generator, never from a counter', async () => {
    const { world, useCase } = setup();

    const first = await useCase.execute(asAdmin);
    const second = await useCase.execute(asAdmin);

    expect(first.session.id).not.toBe(second.session.id);
    // Whatever the generator hands out is what is used, unmodified.
    expect([first.session.id, second.session.id]).toEqual(
      world.ids.issued().slice(0, 2),
    );
  });

  describe('failure', () => {
    it('rejects a wrong password', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ username: 'admin', password: 'not the password' }),
      ).rejects.toBeInstanceOf(AuthenticationFailedError);
    });

    it('rejects an unknown username', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ username: 'nobody', password: 'admin' }),
      ).rejects.toBeInstanceOf(AuthenticationFailedError);
    });

    it('gives the identical message for both, character for character', async () => {
      const { useCase } = setup();

      const wrongPassword = await rejection(
        useCase.execute({ username: 'admin', password: 'wrong' }),
      );
      const unknownUser = await rejection(
        useCase.execute({ username: 'nobody', password: 'wrong' }),
      );

      expect(wrongPassword.message).toBe(unknownUser.message);
      expect(wrongPassword.name).toBe(unknownUser.name);
      expect(wrongPassword.message).toBe(AuthenticationFailedError.MESSAGE);
    });

    it('never names the username in the message', async () => {
      const { useCase } = setup();

      const error = await rejection(
        useCase.execute({ username: 'sudopwr', password: 'hunter2' }),
      );

      expect(error.message).not.toContain('sudopwr');
      expect(error.message).not.toContain('hunter2');
    });

    it('still runs a verification for an unknown username', async () => {
      // Without this the response time tells an attacker which usernames
      // exist, and the shared error message is decoration.
      const { world, useCase } = setup();

      const before = world.hasher.verifications;
      await useCase.execute({ username: 'nobody', password: 'x' }).catch(() => {
        /* expected */
      });

      expect(world.hasher.verifications).toBe(before + 1);
    });

    it('opens no session on a failed attempt', async () => {
      const { world, useCase } = setup();

      await useCase
        .execute({ username: 'admin', password: 'wrong' })
        .catch(() => {
          /* expected */
        });

      expect(await world.sessions.listForUser(1)).toEqual([]);
    });

    it('treats the username as exact — case is not folded', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ username: 'Admin', password: 'admin' }),
      ).rejects.toBeInstanceOf(AuthenticationFailedError);
    });
  });

  describe('rehash on login', () => {
    it('re-hashes a credential stored under weaker parameters', async () => {
      const { world, useCase } = setup();
      const before = (await world.users.findByUsername('admin'))?.passwordHash;

      world.hasher.raiseCost(4);
      await useCase.execute(asAdmin);

      const after = (await world.users.findByUsername('admin'))?.passwordHash;
      expect(after).not.toBe(before);
      // And the same password still works against the new hash.
      await expect(useCase.execute(asAdmin)).resolves.toMatchObject({
        mustChangePassword: true,
      });
    });

    it('leaves the hash alone when the parameters are already current', async () => {
      const { world, useCase } = setup();
      const before = (await world.users.findByUsername('admin'))?.passwordHash;

      await useCase.execute(asAdmin);

      expect((await world.users.findByUsername('admin'))?.passwordHash).toBe(
        before,
      );
    });

    it('does not clear the must-change flag when it rehashes', async () => {
      // A rehash is not a password change. The cage stays shut.
      const { world, useCase } = setup();
      world.hasher.raiseCost(4);

      const result = await useCase.execute(asAdmin);

      expect(result.mustChangePassword).toBe(true);
    });
  });
});
