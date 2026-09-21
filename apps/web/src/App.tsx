import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from './routes';
import { QueryProvider } from './shared/api/QueryProvider';
import { ScopeProvider } from './shared/api/ScopeProvider';
import { ToastProvider } from './shared/feedback';
import { AppTheme } from './shared/theme/AppTheme';

/**
 * The providers, in the order they depend on each other.
 *
 * `QueryProvider` contains `AuthProvider`, because signed-in state *is* a
 * query — the one on `/auth/me`. `ScopeProvider` sits inside it because the
 * scoped hooks (F24) read both, and the toast sits inside all of them so a
 * confirmation raised by a mutation survives the screen that raised it
 * navigating away.
 *
 * Separated from `App` so a test can mount the real provider stack around a
 * `MemoryRouter` and drive the application by URL. Duplicating this list in a
 * test helper would mean testing a stack that is not the one that ships.
 */
export function AppProviders({
  children,
  client,
}: {
  readonly children: ReactNode;
  /** Supplied by a test that wants to inspect the cache; production builds one. */
  readonly client?: QueryClient;
}) {
  return (
    <AppTheme>
      <QueryProvider {...(client === undefined ? {} : { client })}>
        <ScopeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ScopeProvider>
      </QueryProvider>
    </AppTheme>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
