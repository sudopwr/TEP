import type { FastifyInstance } from 'fastify';

import type { GetAccountBalances } from '@payout/core';

export interface AccountRouteDependencies {
  readonly getAccountBalances: GetAccountBalances;
}

/**
 * A data route — F10, UC7.
 *
 * It is here mainly because the two guards need something real to guard: an
 * exemption list is only meaningful if something is not on it. It is also
 * genuinely the endpoint F10 asks for, so it is not scaffolding.
 *
 * Thin, per §5. The only work is turning Money into a pair of fields: the
 * minor units as a string, because 875486900 USDT minor exceeds what JSON
 * numbers represent exactly for larger balances, and a decimal string for
 * display. N1 says money is never a float; that includes on the way out.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: AccountRouteDependencies,
): void {
  app.get('/accounts/balances', async () => {
    const balances = await deps.getAccountBalances.execute();

    return {
      balances: balances.map((entry) => ({
        accountId: entry.account.id,
        accountCode: entry.account.code,
        accountName: entry.account.name,
        currency: entry.currency.code,
        minor: entry.balance.minor.toString(),
        amount: entry.balance.toDecimalString(),
      })),
    };
  });
}
