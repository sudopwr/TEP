import {
  renderHook as baseRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
} from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AuthProvider } from '../src/shared/api/AuthProvider';
import { createQueryClient } from '../src/shared/api/queryClient';
import {
  ScopeProvider,
  type ScopeSelection,
} from '../src/shared/api/ScopeProvider';
import { AppTheme } from '../src/shared/theme/AppTheme';

/**
 * A query client built the way production builds one, then made quiet.
 *
 * The defaults under test — `staleTime`, `retry`, `refetchOnWindowFocus` — are
 * the real ones from `createQueryClient`, because those are the thing being
 * verified. What is overridden is only the noise: a test that waited out a
 * real retry would be a test that takes a second to fail.
 */
export function createTestQueryClient(
  options: { onUnauthenticated?: () => void } = {},
): QueryClient {
  return createQueryClient(options);
}

export interface HookHarness<Result> extends RenderHookResult<Result, unknown> {
  readonly client: QueryClient;
}

/**
 * Render a hook inside the real providers.
 *
 * Nothing here mocks TanStack. The hook runs its real `queryFn`, the real
 * `fetch` goes out, MSW answers it, and the cache this returns is the one the
 * hook wrote to — so a test can assert on what was invalidated rather than on
 * what a spy was called with.
 */
export function renderHookWithClient<Result>(
  hook: () => Result,
  options: {
    readonly client?: QueryClient;
    readonly onUnauthenticated?: () => void;
    /** The selection the hook opens on (F24). Omitted means everything. */
    readonly scope?: ScopeSelection;
  } & Omit<RenderHookOptions<unknown>, 'wrapper'> = {},
): HookHarness<Result> {
  const { client: supplied, onUnauthenticated, scope, ...rest } = options;
  const client =
    supplied ??
    createTestQueryClient(
      onUnauthenticated === undefined ? {} : { onUnauthenticated },
    );

  const result = baseRenderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppTheme>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <ScopeProvider {...(scope === undefined ? {} : { initial: scope })}>
              {children}
            </ScopeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AppTheme>
    ),
    ...rest,
  });

  return Object.assign(result, { client });
}

export * from '@testing-library/react';
