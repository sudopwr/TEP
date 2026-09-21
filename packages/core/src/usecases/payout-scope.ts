import type { TraderId } from '../domain/ids';
import type { Payout } from '../domain/payout';
import type { DateRange, PayoutRepository } from '../ports/payout-repository';

/**
 * Whose money, and when — the two questions every screen now asks first.
 *
 * One shape rather than two parameters threaded separately, because the four
 * read use cases that honour it (the payout list, the balances, the checks
 * and the financial-year report) must honour it *identically*. A balances
 * screen that scoped by trader but not by month would disagree with the list
 * beside it about whose money it was showing, which is the exact failure the
 * spreadsheet this replaced kept making.
 *
 * Both halves are optional and mean "everything": no trader is every
 * trader's, no range is all time. That is the default the interface opens on,
 * so nothing is hidden until somebody chooses to narrow it.
 */
export interface PayoutScope {
  readonly traderId?: TraderId;
  readonly range?: DateRange;
}

/**
 * The payouts a scope selects, narrowed by the repository wherever it can be.
 *
 * `listByTrader` and `listByDateRange` are both indexed (`ix_payout_trader`
 * covers the pair); only the combination falls back to filtering in memory,
 * over rows the database has already narrowed once. N2's budget is a few
 * thousand payouts, and this stays well inside it.
 */
export async function payoutsInScope(
  payouts: PayoutRepository,
  scope: PayoutScope,
): Promise<readonly Payout[]> {
  if (scope.traderId !== undefined && scope.range !== undefined) {
    const inRange = await payouts.listByDateRange(scope.range);
    return inRange.filter((payout) => payout.traderId === scope.traderId);
  }

  if (scope.traderId !== undefined) {
    return payouts.listByTrader(scope.traderId);
  }

  if (scope.range !== undefined) {
    return payouts.listByDateRange(scope.range);
  }

  return payouts.list();
}

/** True when the scope narrows anything at all. */
export function isNarrowed(scope: PayoutScope): boolean {
  return scope.traderId !== undefined || scope.range !== undefined;
}
