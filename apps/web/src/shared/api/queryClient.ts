import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';
import { queryKeys } from './keys';
import type { SessionUserJson } from './types';

/**
 * Thirty seconds.
 *
 * This is a single-user local application reading a SQLite file on the same
 * machine. Nothing changes unless this person changes it, and when they do a
 * mutation invalidates precisely what moved. A short stale time exists only so
 * that a screen left open over lunch is not confidently wrong.
 */
export const STALE_TIME_MS = 30_000;

export interface QueryClientOptions {
  /**
   * Called once when any request answers 401.
   *
   * The redirect, in whatever form the shell provides. In a router-less app
   * clearing the auth cache is itself the redirect — `AuthProvider` sees a
   * null user and the shell renders sign-in — so this is the seam a real
   * router plugs into later without touching a single call site.
   */
  readonly onUnauthenticated?: () => void;
}

/**
 * A 401, handled in one place for every query and every mutation.
 *
 * Both caches share this handler, which is the whole point: a per-call
 * `if (error.status === 401)` is a rule that holds until somebody adds the
 * twelfth hook and forgets. Here there is no call site to forget it in.
 *
 * `/auth/me` answering 401 is *not* a session expiring — it is the ordinary
 * way of asking "is anyone signed in?" and being told no. Treating it as an
 * expiry would clear the cache every time the sign-in screen loads and fire a
 * redirect at the screen the person is already looking at.
 */
function createUnauthenticatedHandler(
  client: () => QueryClient,
  options: QueryClientOptions,
) {
  return (error: unknown, isAuthProbe: boolean): void => {
    if (!(error instanceof ApiError) || !error.isUnauthenticated) return;
    if (isAuthProbe) return;

    // Everything cached was read as somebody who is no longer signed in, so
    // none of it may survive into the next session.
    client().clear();

    // Seeded rather than left absent, so `AuthProvider` reports "signed out"
    // immediately instead of showing a spinner while it asks again.
    client().setQueryData(queryKeys.auth.me(), null);

    options.onUnauthenticated?.();
  };
}

/**
 * F15's 403, handled in the same one place, and by the same mechanism.
 *
 * `password_change_required` means the shipped password is still in place and
 * every data route is shut until it changes (§5a). The browser learns this
 * from any route at any time — a tab left open while the flag was cleared
 * elsewhere, or a session that started before the cage was noticed.
 *
 * Rather than calling a navigation function, this writes the fact onto the
 * auth cache entry, exactly as the 401 path seeds `null` there. The redirect
 * follows because `RequireAuth` reads that entry and sends anyone with the
 * flag set to the change screen — so there is one source of truth for "must
 * this person change their password", and the router is downstream of it
 * rather than a second copy of the answer.
 *
 * The server's 403 is authoritative for this, so there is nothing to refetch.
 * An absent or null entry is left alone: nobody is signed in, and inventing a
 * user here would render a change-password screen for a stranger.
 */
function createPasswordCageHandler(client: () => QueryClient) {
  return (error: unknown): void => {
    if (!(error instanceof ApiError) || !error.needsPasswordChange) return;

    const current = client().getQueryData<SessionUserJson | null>(
      queryKeys.auth.me(),
    );

    if (current === undefined || current === null) {
      // Nothing cached to correct — which happens when a data route answers
      // before the auth probe does. Ask again rather than inventing a user:
      // the server has just told us the flag is set and will say so again.
      void client().invalidateQueries({ queryKey: queryKeys.auth.me() });
      return;
    }

    const caged: SessionUserJson = { ...current, mustChangePassword: true };

    client().setQueryData(queryKeys.auth.me(), caged);
  };
}

export function createQueryClient(
  options: QueryClientOptions = {},
): QueryClient {
  const signedOut = createUnauthenticatedHandler(() => client, options);
  const caged = createPasswordCageHandler(() => client);

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        signedOut(error, isAuthKey(query.queryKey));
        caged(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        signedOut(error, isAuthKey(mutation.options.mutationKey ?? []));
        caged(error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        retry: retryOnce,
        // Local data, not a live feed. Refetching every time the window
        // regains focus would re-read a file nobody else can write, and put a
        // spinner in front of someone who just alt-tabbed back.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        // A failed write is not a flaky read. Retrying a POST risks recording
        // the same transaction twice, and the API keys on a code the caller
        // supplies rather than on anything idempotent per attempt.
        retry: false,
      },
    },
  });

  return client;
}

/**
 * True for the auth query and the auth mutations, which answer 401 normally.
 *
 * `/auth/me` answering 401 means "nobody is signed in". `/auth/login`
 * answering 401 means "those were not the right credentials", and
 * `/auth/change-credentials` answering it means "that is not your current
 * password". None of the three is a session expiring, and treating them as
 * one is worse than useless: clearing the cache on a failed sign-in throws
 * away the mutation that holds the error, so the person types a wrong
 * password and is shown nothing at all.
 *
 * Which is why the auth mutations carry a `mutationKey` — it exists only to
 * be recognised here, the same way the query key is.
 */
function isAuthKey(key: readonly unknown[]): boolean {
  return key[0] === 'auth';
}

/**
 * One retry, and none at all for an answer that will not change.
 *
 * Retrying a 404 or a 400 asks the same question twice and doubles the time
 * before the person sees the answer. A 401 is worse: the second attempt is a
 * second failed request against a session that is already gone.
 */
function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 1;
}
