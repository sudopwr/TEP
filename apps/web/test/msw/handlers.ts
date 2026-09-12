import { HttpResponse, http } from 'msw';

/**
 * The default world a component test renders into: the reference payout, as
 * the real API returns it.
 *
 * These figures are §10's, copied from nowhere — they are what
 * `GET /api/accounts/balances` actually answered when the server was run
 * against the imported legacy sheet. Both dust balances are here because they
 * are the hard case for the numeric column: eight decimal places under two.
 *
 * MSW intercepts at the network layer, so the component under test runs its
 * real `fetch`, its real error handling and its real loading state. Nothing is
 * stubbed inside the component, which is the difference between testing the
 * component and testing a mock.
 */
export const REFERENCE_BALANCES = {
  balances: [
    {
      account: {
        id: 5,
        code: 'bank-hdfc',
        name: 'HDFC Bank',
        type: 'bank',
      },
      balance: { currency: 'INR', minor: '8464293', amount: '84642.93' },
    },
    {
      account: {
        id: 4,
        code: 'coindcx',
        name: 'CoinDCX',
        type: 'exchange',
      },
      balance: {
        currency: 'USDT',
        minor: '1409080000',
        amount: '14.09080000',
      },
    },
    {
      account: {
        id: 3,
        code: 'trustwallet',
        name: 'Trust Wallet',
        type: 'wallet',
      },
      balance: { currency: 'USDT', minor: '133230000', amount: '1.33230000' },
    },
    {
      account: {
        id: 1,
        code: 'tradeify',
        name: 'Tradeify',
        type: 'prop_firm',
      },
      balance: { currency: 'USD', minor: '-100801', amount: '-1008.01' },
    },
  ],
} as const;

export const handlers = [
  http.get('/api/accounts/balances', () =>
    HttpResponse.json(REFERENCE_BALANCES),
  ),

  http.get('/auth/me', () =>
    HttpResponse.json({ username: 'admin', mustChangePassword: false }),
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
