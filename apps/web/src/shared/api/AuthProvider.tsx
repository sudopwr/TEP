import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { changeCredentials, fetchMe, signIn, signOut } from './endpoints';
import { queryKeys } from './keys';
import type {
  ChangeCredentialsCommand,
  CredentialsChangedJson,
  SessionUserJson,
  SignInCommand,
} from './types';

/**
 * Signed-in state, from one `useQuery` on `/auth/me`.
 *
 * The single source of truth, and that phrase is doing real work. The
 * tempting alternative is to also keep a `user` in React state, set on a
 * successful sign-in — and then there are two answers to "who is signed in",
 * which disagree the moment a session is revoked in another tab, or expires,
 * or `ChangeCredentials` sweeps it. Here every path ends at the same cache
 * entry: sign-in writes it, sign-out clears it, and the global 401 handler in
 * `queryClient.ts` clears it when the server disagrees with all of them.
 */

export interface AuthState {
  /** The signed-in user, or null when nobody is. */
  readonly user: SessionUserJson | null;
  /** True until the first `/auth/me` answers. Not the same as signed out. */
  readonly isLoading: boolean;
  readonly isSignedIn: boolean;
  /**
   * F15: the shipped password is still in place. Every data route is 403
   * until it changes, so the shell shows the change screen and nothing else.
   */
  readonly mustChangePassword: boolean;
  readonly signIn: UseMutationResult<SessionUserJson, Error, SignInCommand>;
  readonly signOut: UseMutationResult<null, Error, void>;
  readonly changeCredentials: UseMutationResult<
    CredentialsChangedJson,
    Error,
    ChangeCredentialsCommand
  >;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const me = useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: ({ signal }) => fetchMe(signal),
    // The session outlives a tab, so asking again on every mount is a wasted
    // round trip. It is re-read when a mutation says so, and on a hard reload.
    staleTime: 5 * 60_000,
    // A failed auth probe must not retry: `fetchMe` already turns 401 into
    // null, so a rejection here is a real server failure and asking twice
    // only doubles the wait before the person sees it.
    retry: false,
  });

  const signInMutation = useMutation<SessionUserJson, Error, SignInCommand>({
    // Tagged so the global 401 handler can tell "those credentials were
    // wrong" from "your session has expired" — see `queryClient.ts`.
    mutationKey: queryKeys.auth.me(),
    mutationFn: signIn,
    onSuccess: (user) => {
      // Written straight into the cache rather than invalidated: the response
      // *is* the answer `/auth/me` would give, so a refetch would ask a
      // question already answered and put a spinner between the click and the
      // application.
      client.setQueryData(queryKeys.auth.me(), user);
    },
  });

  const signOutMutation = useMutation<null, Error, void>({
    mutationKey: queryKeys.auth.me(),
    mutationFn: signOut,
    onSuccess: () => {
      // Everything cached belonged to the session that just ended.
      client.clear();
      client.setQueryData(queryKeys.auth.me(), null);
    },
  });

  const changeCredentialsMutation = useMutation<
    CredentialsChangedJson,
    Error,
    ChangeCredentialsCommand
  >({
    mutationKey: queryKeys.auth.me(),
    mutationFn: changeCredentials,
    onSuccess: (result) => {
      // The username may have changed and `mustChangePassword` may have just
      // cleared — both live on this entry, and F15's guard reads it.
      client.setQueryData(queryKeys.auth.me(), {
        username: result.username,
        mustChangePassword: result.mustChangePassword,
      } satisfies SessionUserJson);
    },
  });

  const value = useMemo<AuthState>(() => {
    const user = me.data ?? null;

    return {
      user,
      isLoading: me.isPending,
      isSignedIn: user !== null,
      mustChangePassword: user?.mustChangePassword ?? false,
      signIn: signInMutation,
      signOut: signOutMutation,
      changeCredentials: changeCredentialsMutation,
    };
  }, [
    me.data,
    me.isPending,
    signInMutation,
    signOutMutation,
    changeCredentialsMutation,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The signed-in state. Throws outside the provider rather than returning a
 * plausible "signed out", which would render the sign-in screen to somebody
 * who is signed in and send a developer hunting for a session bug.
 */
export function useAuth(): AuthState {
  const value = useContext(AuthContext);

  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }

  return value;
}
