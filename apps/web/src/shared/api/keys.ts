import type { FinancialYearFilter, PayoutFilter } from './types';

/**
 * Every cache key in the application, in one place.
 *
 * No call site ever writes `['payouts', id]`. That rule is not tidiness: a key
 * typed out at a call site is a key that can be typed *differently* at the
 * next one, and the two then look like separate caches that happen to hold the
 * same data. The failure is silent — a mutation invalidates one spelling, the
 * screen reads the other, and the number on screen is simply stale.
 *
 * The shape is hierarchical on purpose. TanStack matches a key prefix, so
 * `invalidateQueries({ queryKey: queryKeys.payouts.detail(7) })` reaches
 * `['payouts', 7, 'trail']` and `['payouts', 7, 'settlement']` and nothing
 * belonging to payout 8. That is what makes "invalidate precisely" expressible
 * rather than aspirational.
 *
 * ```
 * ['auth', 'me']
 * ['companies', 'list']
 * ['accounts', 'list', type]
 * ['payouts', 'list', filter]
 * ['payouts', 7]                 <- prefix for everything about payout 7
 * ['payouts', 7, 'trail']
 * ['payouts', 7, 'settlement', currency]
 * ['transactions', 'list', filter]
 * ['balances', filter]
 * ['dataQuality', filter]
 * ['documents', 'search', query]
 * ['reports', 'financialYear', range]
 * ```
 */
export const queryKeys = {
  auth: {
    /** The signed-in user. The single source of truth for auth state. */
    all: () => ['auth'] as const,
    me: () => ['auth', 'me'] as const,
  },

  companies: {
    all: () => ['companies'] as const,
    list: () => ['companies', 'list'] as const,
  },

  /**
   * Every account, whether or not money has moved through it.
   *
   * Deliberately its own tree rather than a branch of `balances`: the two
   * answer different questions, and a mutation that adds an account must not
   * invalidate a derived balance that cannot have changed.
   */
  accounts: {
    all: () => ['accounts'] as const,
    list: (type?: string) => ['accounts', 'list', type ?? null] as const,
  },

  payouts: {
    all: () => ['payouts'] as const,
    lists: () => ['payouts', 'list'] as const,
    list: (filter: PayoutFilter = {}) => ['payouts', 'list', filter] as const,

    /**
     * Everything about one payout. Never fetched directly — it exists to be
     * invalidated, taking the trail and the settlement with it.
     */
    detail: (payoutId: number) => ['payouts', payoutId] as const,
    trail: (payoutId: number) => ['payouts', payoutId, 'trail'] as const,

    /**
     * Every settlement of one payout, whichever currency it was asked in.
     *
     * The prefix the optimistic update writes through: a settlement fetched
     * with no currency and one fetched as INR are two cache entries of the
     * same fact, and flipping the status in one but not the other is how two
     * open tabs disagree.
     */
    settlements: (payoutId: number) =>
      ['payouts', payoutId, 'settlement'] as const,
    settlement: (payoutId: number, currencyCode?: string) =>
      ['payouts', payoutId, 'settlement', currencyCode ?? null] as const,
  },

  transactions: {
    all: () => ['transactions'] as const,
    lists: () => ['transactions', 'list'] as const,
    list: (payoutId?: number) =>
      ['transactions', 'list', payoutId ?? null] as const,
  },

  balances: {
    all: () => ['balances'] as const,
    list: (payoutId?: number) => ['balances', payoutId ?? null] as const,
  },

  dataQuality: {
    all: () => ['dataQuality'] as const,
    list: (payoutId?: number, tolerancePct?: number) =>
      ['dataQuality', payoutId ?? null, tolerancePct ?? null] as const,
  },

  documents: {
    all: () => ['documents'] as const,
    search: (query: string) => ['documents', 'search', query] as const,
  },

  reports: {
    all: () => ['reports'] as const,
    financialYear: (filter: FinancialYearFilter) =>
      ['reports', 'financialYear', filter] as const,
  },
} as const;

/**
 * The caches a change to one payout's transactions invalidates, and no others.
 *
 * Named here rather than written out at each mutation so the answer to "what
 * does recording a leg affect?" lives in one place and is testable.
 *
 * Why each:
 *   - that payout's trail and settlement: the tree and the totals changed;
 *   - balances: money moved between accounts;
 *   - data quality: a new leg is a new row the checks can flag.
 *
 * What is deliberately *not* here:
 *   - the payouts list, which carries gross, charges and reference — none of
 *     which a transaction touches. Status is derived and appears only in the
 *     settlement, so the list genuinely has nothing to re-read;
 *   - companies, documents, reports, and every other payout.
 */
export function cachesAffectedByTransaction(
  payoutId: number,
): readonly (readonly unknown[])[] {
  return [
    queryKeys.payouts.detail(payoutId),
    queryKeys.transactions.all(),
    queryKeys.balances.all(),
    queryKeys.dataQuality.all(),
  ];
}
