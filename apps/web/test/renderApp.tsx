import { render, type RenderResult } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AppProviders } from '../src/App';
import { AppRoutes } from '../src/routes';
import { createQueryClient } from '../src/shared/api/queryClient';

/**
 * The whole application, at a URL, against MSW.
 *
 * `AppProviders` is imported from `App.tsx` rather than rebuilt here, so a
 * feature test exercises the provider stack that actually ships — including
 * the real query client, the real `AuthProvider` and the real 401 and 403
 * handling. The only substitution is `MemoryRouter` for `BrowserRouter`,
 * which is what lets a test start at `/payouts/1` and assert on where a
 * redirect took it.
 */

export interface AppHarness extends RenderResult {
  readonly client: QueryClient;
}

export function renderApp(
  options: { readonly route?: string; readonly client?: QueryClient } = {},
): AppHarness {
  const client = options.client ?? createQueryClient();

  const result = render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[options.route ?? '/payouts']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );

  return Object.assign(result, { client });
}

/**
 * One feature component, with everything it can reach for.
 *
 * For screens that are not a whole route — a form, a panel — but that still
 * use `useNavigate`, a query, or the toast.
 */
export function renderFeature(
  ui: ReactElement,
  options: { readonly route?: string; readonly client?: QueryClient } = {},
): AppHarness {
  const client = options.client ?? createQueryClient();

  const result = render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </AppProviders>,
  );

  return Object.assign(result, { client });
}

export * from '@testing-library/react';
