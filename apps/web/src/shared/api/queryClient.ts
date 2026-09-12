import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';
import { queryKeys } from './keys';

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

export function createQueryClient(
  options: QueryClientOptions = {},
): QueryClient {
  const signedOut = createUnauthenticatedHandler(() => client, options);

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        signedOut(error, isAuthKey(query.queryKey));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        signedOut(error, false);
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

/** True for the `/auth/me` probe, which answers 401 as a normal outcome. */
function isAuthKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'auth';
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
