import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADMIN_ID,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  TestWorld,
} from '../../test/fakes/world';
import { rejection } from '../../test/rejection';
import {
  AuthenticationFailedError,
  PasswordPolicyError,
} from '../domain/errors';

import { AuthenticateSession } from './authenticate-session';
import { ChangeCredentials } from './change-credentials';
import { SignIn } from './sign-in';

const GOOD_PASSWORD = 'a quiet harbour lamp';

const setup = () => {
  const world = new TestWorld();

  const signIn = new SignIn({
    users: world.users,
    sessions: world.sessions,
    hasher: world.hasher,
    ids: world.ids,
    clock: world.clock,
  });

  const useCase = new ChangeCredentials({
    users: world.users,
    sessions: world.sessions,
    hasher: world.hasher,
    clock: world.clock,
  });

  const authenticate = new AuthenticateSession({
    sessions: world.sessions,
    users: world.users,
    clock: world.clock,
  });

  const open = () =>
    signIn.execute({
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
    });

  return { world, useCase, signIn, authenticate, open };
};

const change = (overrides: Record<string, unknown> = {}) => ({
  userId: DEFAULT_ADMIN_ID,
  currentPassword: DEFAULT_ADMIN_PASSWORD,
  newPassword: GOOD_PASSWORD,
  ...overrides,
});

describe('ChangeCredentials (UC13)', () => {
  describe('changing the password', () => {
    it('clears the must-change flag', async () => {
      const { useCase } = setup();

      const result = await useCase.execute(change());

      expect(result.passwordChanged).toBe(true);
      expect(result.user.mustChangePassword).toBe(false);
    });

    it('stamps password_changed_at from the injected clock', async () => {
      const { world, useCase } = setup();
      world.clock.set('2025-03-16T10:30:00.000Z');

      const result = await useCase.execute(change());

      expect(result.user.passwordChangedAt).toBe('2025-03-16T10:30:00.000Z');
    });

    it('makes the new password work and the old one stop working', async () => {
      const { useCase, signIn } = setup();

      await useCase.execute(change());

      await expect(
        signIn.execute({ username: 'admin', password: GOOD_PASSWORD }),
      ).resolves.toMatchObject({ mustChangePassword: false });
      await expect(
        signIn.execute({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD }),
      ).rejects.toBeInstanceOf(AuthenticationFailedError);
    });

    it('stores a hash, never the plaintext', async () => {
      const { useCase } = setup();

      const result = await useCase.execute(change());

      expect(result.user.passwordHash).not.toContain(GOOD_PASSWORD);
    });

    it('persists, rather than only returning the new user', async () => {
      const { world, useCase } = setup();

      await useCase.execute(change());

      const reread = await world.users.findById(DEFAULT_ADMIN_ID);
      expect(reread?.mustChangePassword).toBe(false);
    });
  });

  describe('verifying the current password first', () => {
    it('rejects a wrong current password', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute(change({ currentPassword: 'not it' })),
      ).rejects.toBeInstanceOf(AuthenticationFailedError);
    });

    it('changes nothing when the current password is wrong', async () => {
      const { world, useCase } = setup();

      await useCase.execute(change({ currentPassword: 'not it' })).catch(() => {
        /* expected */
      });

      const reread = await world.users.findById(DEFAULT_ADMIN_ID);
      expect(reread?.mustChangePassword).toBe(true);
      expect(reread?.username).toBe('admin');
    });

    it('checks the password before it checks anything else', async () => {
      // Otherwise this endpoint answers "is this username taken?" for free,
      // to anyone holding a session but not the password.
      const { useCase } = setup();

      const error = await rejection<Error>(
        useCase.execute(
          change({
            currentPassword: 'not it',
            newUsername: 'x',
            newPassword: 'short',
          }),
        ),
      );

      expect(error).toBeInstanceOf(AuthenticationFailedError);
    });
  });

  describe('the password policy', () => {
    it('rejects a password under twelve characters', async () => {
      const { useCase } = setup();

      const error = await rejection<PasswordPolicyError>(
        useCase.execute(change({ newPassword: 'elevenchars' })),
      );

      expect(error).toBeInstanceOf(PasswordPolicyError);
      expect(error.violations).toContain('too_short');
    });

    it('rejects a password equal to the username', async () => {
      const { useCase } = setup();

      const error = await rejection<PasswordPolicyError>(
        useCase.execute(
          change({
            newUsername: 'harbourmaster',
            newPassword: 'harbourmaster',
          }),
        ),
      );

      expect(error.violations).toContain('same_as_username');
    });

    it('checks against the NEW username, not the one being replaced', async () => {
      // Changing both at once in one call must not slip past the check.
      const { useCase, world } = setup();

      await expect(
        useCase.execute(
          change({
            newUsername: 'harbourmaster',
            newPassword: 'HarbourMaster',
          }),
        ),
      ).rejects.toBeInstanceOf(PasswordPolicyError);

      expect((await world.users.findById(DEFAULT_ADMIN_ID))?.username).toBe(
        'admin',
      );
    });

    it('rejects reuse of the current password', async () => {
      const { useCase } = setup();
      await useCase.execute(change());

      const error = await rejection<PasswordPolicyError>(
        useCase.execute(
          change({
            currentPassword: GOOD_PASSWORD,
            newPassword: GOOD_PASSWORD,
          }),
        ),
      );

      expect(error).toBeInstanceOf(PasswordPolicyError);
      expect(error.violations).toContain('same_as_current');
    });

    it('rejects the shipped default being set again deliberately', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute(change({ newPassword: DEFAULT_ADMIN_PASSWORD })),
      ).rejects.toBeInstanceOf(PasswordPolicyError);
    });

    it('never puts the rejected password in the message', async () => {
      const { useCase } = setup();

      const error = await rejection(
        useCase.execute(change({ newPassword: 'hunter2' })),
      );

      expect(error.message).not.toContain('hunter2');
    });

    it('leaves the flag set when the policy refuses', async () => {
      const { world, useCase } = setup();

      await useCase.execute(change({ newPassword: 'short' })).catch(() => {
        /* expected */
      });

      expect(
        (await world.users.findById(DEFAULT_ADMIN_ID))?.mustChangePassword,
      ).toBe(true);
    });
  });

  describe('changing the username', () => {
    it('renames without touching the password', async () => {
      const { useCase, signIn } = setup();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: 'kd',
      });

      expect(result.usernameChanged).toBe(true);
      expect(result.passwordChanged).toBe(false);
      await expect(
        signIn.execute({ username: 'kd', password: DEFAULT_ADMIN_PASSWORD }),
      ).resolves.toBeTruthy();
    });

    it('does NOT clear the must-change flag on a rename alone', async () => {
      // §5a offers no path past the change screen. A rename is not a path.
      const { useCase } = setup();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: 'kd',
      });

      expect(result.user.mustChangePassword).toBe(true);
    });

    it('trims surrounding whitespace', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: '  kd  ',
      });

      expect(result.user.username).toBe('kd');
    });

    it('rejects a username with whitespace inside it', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({
          userId: DEFAULT_ADMIN_ID,
          currentPassword: DEFAULT_ADMIN_PASSWORD,
          newUsername: 'k d',
        }),
      ).rejects.toMatchObject({ name: 'InvalidUsernameError' });
    });

    it('accepts a short username, because nothing says it should not', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: 'kd',
      });

      expect(result.user.username).toBe('kd');
    });

    it('rejects an empty username', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({
          userId: DEFAULT_ADMIN_ID,
          currentPassword: DEFAULT_ADMIN_PASSWORD,
          newUsername: '   ',
        }),
      ).rejects.toMatchObject({ name: 'InvalidUsernameError' });
    });

    it('rejects a username longer than the column', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({
          userId: DEFAULT_ADMIN_ID,
          currentPassword: DEFAULT_ADMIN_PASSWORD,
          newUsername: 'a'.repeat(65),
        }),
      ).rejects.toMatchObject({ name: 'InvalidUsernameError' });
    });

    it('treats renaming to the same name as no change at all', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: 'admin',
      });

      expect(result.usernameChanged).toBe(false);
      expect(result.sessionsRevoked).toBe(0);
    });
  });

  describe('revoking other sessions', () => {
    it('invalidates a session opened earlier', async () => {
      const { useCase, authenticate, open } = setup();
      const other = await open();
      const current = await open();

      await useCase.execute(change({ currentSessionId: current.session.id }));

      await expect(
        authenticate.execute({ sessionId: other.session.id }),
      ).rejects.toMatchObject({ reason: 'revoked' });
    });

    it('spares the session the change was made from', async () => {
      const { useCase, authenticate, open } = setup();
      await open();
      const current = await open();

      await useCase.execute(change({ currentSessionId: current.session.id }));

      await expect(
        authenticate.execute({ sessionId: current.session.id }),
      ).resolves.toMatchObject({ extended: false });
    });

    it('reports how many it revoked', async () => {
      const { useCase, open } = setup();
      await open();
      await open();
      const current = await open();

      const result = await useCase.execute(
        change({ currentSessionId: current.session.id }),
      );

      expect(result.sessionsRevoked).toBe(2);
    });

    it('revokes everything when no current session is named', async () => {
      const { useCase, open } = setup();
      await open();
      await open();

      const result = await useCase.execute(change());

      expect(result.sessionsRevoked).toBe(2);
    });

    it('sweeps on a username-only change too', async () => {
      // The reason anyone changes a credential is that they think it leaked.
      const { useCase, open } = setup();
      await open();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
        newUsername: 'kd',
      });

      expect(result.sessionsRevoked).toBe(1);
    });

    it('does not sweep when the call changed nothing', async () => {
      const { useCase, open } = setup();
      const session = await open();

      const result = await useCase.execute({
        userId: DEFAULT_ADMIN_ID,
        currentPassword: DEFAULT_ADMIN_PASSWORD,
      });

      expect(result).toMatchObject({
        passwordChanged: false,
        usernameChanged: false,
        sessionsRevoked: 0,
      });
      expect(session.session.isRevoked()).toBe(false);
    });
  });

  it('rejects an unknown user', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(change({ userId: 999 })),
    ).rejects.toMatchObject({ name: 'UserNotFoundError' });
  });
});
