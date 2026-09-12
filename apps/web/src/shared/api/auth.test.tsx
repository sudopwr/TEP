import { describe, expect, it, vi } from 'vitest';

import {
  passwordChangeRequired,
  signedOut,
  unauthenticated,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderHookWithClient, waitFor } from '../../../test/renderHook';

import { useAuth } from './AuthProvider';
import { usePayouts } from './hooks/queries';
import { queryKeys } from './keys';
import { createQueryClient } from './queryClient';

/**
 * The 401 rule and the auth state, both exercised through real queries.
 *
 * Every test here drives the behaviour through a hook and MSW rather than
 * calling the handler directly, because the thing worth proving is that the
 * rule fires *without any call site participating* — that is the whole claim.
 */

describe('the 401 rule, handled in one place', () => {
  it('clears every cache when a data route answers 401', async () => {
    // Not just the auth entry: a signed-out session must not leave somebody's
    // balances in memory for the next sign-in to flash up.
    server.use(unauthenticated('/api/payouts'));

    const client = createQueryClient();
    client.setQueryData(queryKeys.balances.list(), { balances: ['secret'] });
    client.setQueryData(queryKeys.companies.list(), { companies: ['secret'] });

    const { result } = renderHookWithClient(() => usePayouts(), { client });

    await waitFor(() => {
      expect(client.getQueryData(queryKeys.balances.list())).toBeUndefined();
    });

    expect(client.getQueryData(queryKeys.companies.list())).toBeUndefined();
    expect(result.current.data).toBeUndefined();
  });

  it('seeds the auth cache with null, so the shell knows immediately', async () => {
    server.use(unauthenticated('/api/payouts'));

    const client = createQueryClient();
    const { result: _result } = renderHookWithClient(() => usePayouts(), {
      client,
    });

    await waitFor(() => {
      expect(client.getQueryData(queryKeys.auth.me())).toBeNull();
    });
  });

  it('calls onUnauthenticated once, for the redirect', async () => {
    server.use(unauthenticated('/api/payouts'));
    const onUnauthenticated = vi.fn();

    const client = createQueryClient({ onUnauthenticated });
    renderHookWithClient(() => usePayouts(), { client });

    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalled();
    });
  });

  it('does not fire on a 403 — that is the password cage, not a lost session', async () => {
    // F15's 403 means "change your password", and clearing the cache and
    // bouncing to sign-in would be the wrong answer to it.
    server.use(passwordChangeRequired('/api/payouts'));
    const onUnauthenticated = vi.fn();

    const client = createQueryClient({ onUnauthenticated });
    client.setQueryData(queryKeys.balances.list(), { balances: ['kept'] });

    const { result } = renderHookWithClient(() => usePayouts(), { client });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.balances.list())).toBeDefined();
  });

  it('does not fire when /auth/me itself answers 401', async () => {
    // That is the ordinary way of asking "is anyone signed in?" and being
    // told no. Treating it as an expiry would clear the cache on every load
    // of the sign-in screen and redirect at the screen already showing.
    server.use(signedOut());
    const onUnauthenticated = vi.fn();

    const client = createQueryClient({ onUnauthenticated });
    const { result } = renderHookWithClient(() => useAuth(), { client });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isSignedIn).toBe(false);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});

describe('AuthProvider', () => {
  it('reports the signed-in user from /auth/me', async () => {
    const { result } = renderHookWithClient(() => useAuth());

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(true);
    });

    expect(result.current.user?.username).toBe('admin');
    expect(result.current.mustChangePassword).toBe(false);
  });

  it('distinguishes "still asking" from "signed out"', () => {
    // Rendering the sign-in screen during the first probe would flash it in
    // front of somebody who is signed in, on every reload.
    const { result } = renderHookWithClient(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSignedIn).toBe(false);
  });

  it('reports nobody when the server says nobody', async () => {
    server.use(signedOut());

    const { result } = renderHookWithClient(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it('writes the sign-in response straight into the auth cache', async () => {
    // Rather than invalidating: the response *is* what /auth/me would answer,
    // so a refetch would put a spinner between the click and the application.
    server.use(signedOut());

    const client = createQueryClient();
    const { result } = renderHookWithClient(() => useAuth(), { client });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    server.resetHandlers();
    result.current.signIn.mutate({ username: 'admin', password: 'admin' });

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(true);
    });

    expect(client.getQueryData(queryKeys.auth.me())).toEqual({
      username: 'admin',
      mustChangePassword: false,
    });
  });

  it('clears everything on sign-out', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.balances.list(), { balances: ['secret'] });

    const { result } = renderHookWithClient(() => useAuth(), { client });

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(true);
    });

    result.current.signOut.mutate();

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(false);
    });

    expect(client.getQueryData(queryKeys.balances.list())).toBeUndefined();
  });

  it('updates the auth cache when credentials change', async () => {
    // Both the username and F15's flag live on this entry, and the guard
    // reads it — so a stale one keeps somebody in the password cage.
    const client = createQueryClient();
    const { result } = renderHookWithClient(() => useAuth(), { client });

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(true);
    });

    result.current.changeCredentials.mutate({
      currentPassword: 'admin',
      newPassword: 'a quiet harbour lamp',
    });

    await waitFor(() => {
      expect(result.current.changeCredentials.isSuccess).toBe(true);
    });

    expect(result.current.mustChangePassword).toBe(false);
    expect(result.current.user?.username).toBe('admin');
  });

  it('holds no state of its own — the cache entry is the truth', async () => {
    // The claim, tested directly: write the cache and `useAuth` follows. If
    // sign-in also kept a local `user`, this write would be ignored and the
    // two answers to "who is signed in" could drift apart — which is exactly
    // what happens when a session is revoked in another tab.
    const client = createQueryClient();
    const { result } = renderHookWithClient(() => useAuth(), { client });

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(true);
    });

    client.setQueryData(queryKeys.auth.me(), {
      username: 'kd',
      mustChangePassword: true,
    });

    await waitFor(() => {
      expect(result.current.user?.username).toBe('kd');
    });
    expect(result.current.mustChangePassword).toBe(true);

    client.setQueryData(queryKeys.auth.me(), null);

    await waitFor(() => {
      expect(result.current.isSignedIn).toBe(false);
    });
  });
});
