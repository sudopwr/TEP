import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { AuthProvider } from './AuthProvider';
import { createQueryClient, type QueryClientOptions } from './queryClient';

/**
 * The cache and the auth state, in the order they depend on each other.
 *
 * `AuthProvider` lives inside `QueryClientProvider` because it *is* a query —
 * the one on `/auth/me`. Putting it outside would need a second mechanism for
 * signed-in state, which is the duplication the whole design avoids.
 */
export function QueryProvider({
  children,
  client,
  ...options
}: {
  readonly children: ReactNode;
  /** Supply one in a test; production builds its own. */
  readonly client?: QueryClient;
} & QueryClientOptions) {
  // `useState` with an initialiser, not `useMemo`: a client must be created
  // exactly once per provider. `useMemo` is a performance hint React may
  // discard, and a discarded query client throws away every cache entry.
  const [created] = useState(() => client ?? createQueryClient(options));

  return (
    <QueryClientProvider client={created}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
