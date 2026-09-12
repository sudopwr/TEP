import { HttpResponse, http } from 'msw';

import {
  BALANCES,
  DOCUMENTS,
  ISSUES,
  PAYOUT,
  RISE_CO,
  SETTLEMENT,
  TRADEIFY,
  TRAIL,
  TRANSACTIONS,
} from './fixtures';

/**
 * The whole API, answered at the network layer.
 *
 * MSW intercepts below `fetch`, so every hook test runs the real client, the
 * real TanStack code paths, the real cache and the real invalidation. Nothing
 * stubs `useQuery`: a test that did would be asserting on its own mock, and
 * would keep passing through a rewrite of the very thing it claims to check.
 */

export const REFERENCE_BALANCES = { balances: BALANCES } as const;

export const handlers = [
  // ---------- Auth ----------
  http.get('/auth/me', () =>
    HttpResponse.json({ username: 'admin', mustChangePassword: false }),
  ),
  http.post('/auth/login', () =>
    HttpResponse.json({ username: 'admin', mustChangePassword: false }),
  ),
  http.post('/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.post('/auth/change-credentials', () =>
    HttpResponse.json({
      username: 'admin',
      mustChangePassword: false,
      passwordChanged: true,
      usernameChanged: false,
      otherSessionsRevoked: 1,
    }),
  ),

  // ---------- Data ----------
  http.get('/api/companies', () =>
    HttpResponse.json({ companies: [TRADEIFY, RISE_CO] }),
  ),
  http.post('/api/companies', () =>
    HttpResponse.json({ company: TRADEIFY }, { status: 201 }),
  ),

  http.get('/api/payouts', () => HttpResponse.json({ payouts: [PAYOUT] })),
  http.post('/api/payouts', () =>
    HttpResponse.json({ payout: PAYOUT }, { status: 201 }),
  ),
  http.get('/api/payouts/:id/trail', () => HttpResponse.json(TRAIL)),
  http.get('/api/payouts/:id/settlement', () => HttpResponse.json(SETTLEMENT)),

  http.get('/api/transactions', () =>
    HttpResponse.json({ transactions: TRANSACTIONS }),
  ),
  http.post('/api/transactions', () =>
    HttpResponse.json(
      {
        transaction: TRANSACTIONS[1],
        grossProceeds: SETTLEMENT.grossProceeds,
        fees: [],
        totalFees: SETTLEMENT.totalFees,
        netCredited: SETTLEMENT.netCredited,
      },
      { status: 201 },
    ),
  ),

  http.post('/api/transactions/:id/documents', () =>
    HttpResponse.json(
      { document: DOCUMENTS[0], created: true },
      { status: 201 },
    ),
  ),
  http.get('/api/documents/search', () =>
    HttpResponse.json({ documents: DOCUMENTS }),
  ),

  http.get('/api/accounts/balances', () =>
    HttpResponse.json(REFERENCE_BALANCES),
  ),
  http.get('/api/data-quality', () => HttpResponse.json({ issues: ISSUES })),

  http.get('/api/reports/financial-year', () =>
    HttpResponse.json({
      range: { from: '2024-04-01', to: '2025-03-31' },
      currency: 'INR',
      totalCredited: SETTLEMENT.netCredited,
      totalTds: SETTLEMENT.feesByType.tds,
      totalFees: SETTLEMENT.totalFees,
      byCompany: [],
    }),
  ),
];

/** 401, in the exact shape `apps/api/src/routes/errors.ts` sends. */
export const unauthenticated = (path: string) =>
  http.get(path, () =>
    HttpResponse.json(
      { code: 'authentication_required', message: 'Sign in to continue.' },
      { status: 401 },
    ),
  );

/** 403 with F15's code — the shipped password is still in place (§5a). */
export const passwordChangeRequired = (path: string) =>
  http.get(path, () =>
    HttpResponse.json(
      {
        code: 'password_change_required',
        message:
          'The default password is still in place. Change it before using the application.',
      },
      { status: 403 },
    ),
  );

/** A server that is not running at all, rather than one answering badly. */
export const unreachable = (path: string) =>
  http.get(path, () => HttpResponse.error());

/** Any POST that refuses, for testing rollback. */
export const postFails = (path: string, status = 400) =>
  http.post(path, () =>
    HttpResponse.json(
      { code: 'same_account_transfer', message: 'That leg sends to itself.' },
      { status },
    ),
  );

/** Nobody signed in, for the auth-probe path. */
export const signedOut = () =>
  http.get('/auth/me', () =>
    HttpResponse.json(
      { code: 'authentication_required', message: 'Sign in to continue.' },
      { status: 401 },
    ),
  );
