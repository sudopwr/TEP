import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ScopeFilter } from './types';

/**
 * Whose money, and when — the selection every scoped screen reads (F24).
 *
 * State, not a query: nothing here is fetched. It holds what the person chose
 * in the bar at the top of the shell, and `usePayouts`, `useAccountBalances`,
 * `useDataQuality` and `useFinancialYearReport` fold it into their cache keys
 * and their requests. That folding happens in the hooks rather than at each
 * call site on purpose — a screen that forgot to pass the scope would show
 * one person's list beside another's balances, and nothing would look wrong.
 *
 * It lives beside `AuthProvider` under `shared/api/` because the hooks read
 * it, and `shared/` outside this folder may not import `shared/api` (N8). It
 * is not auth: signing in says who is *using* the application, and this says
 * whose money is on screen.
 *
 * Both halves default to "everything". The application opens showing every
 * trader and every year, so nothing is hidden until somebody hides it.
 */

export interface ScopeSelection {
  /** The chosen trader, or null for everybody's. */
  readonly traderId: number | null;
  /** A calendar year, or null for all time. */
  readonly year: number | null;
  /** 1–12, or null for the whole year. Meaningless without a year. */
  readonly month: number | null;
}

export interface ScopeState extends ScopeSelection {
  /**
   * The selection as the server and the cache keys take it.
   *
   * Derived rather than stored: a second copy would be one more thing that
   * can disagree, and this one is cheap. `{}` means unnarrowed, which is the
   * same shape `queryKeys` hashes for a screen that was never scoped at all.
   */
  readonly filter: ScopeFilter;
  /** True when anything at all is narrowed — what the "Clear" control needs. */
  readonly isNarrowed: boolean;
  readonly setTraderId: (traderId: number | null) => void;
  readonly setYear: (year: number | null) => void;
  readonly setMonth: (month: number | null) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

const ALL_TIME: ScopeSelection = { traderId: null, year: null, month: null };

export function ScopeProvider({
  children,
  initial = ALL_TIME,
}: {
  readonly children: ReactNode;
  /** For tests and for a screen that opens already narrowed. */
  readonly initial?: ScopeSelection;
}) {
  const [selection, setSelection] = useState<ScopeSelection>(initial);

  const value = useMemo<ScopeState>(() => {
    const range = periodRange(selection.year, selection.month);
    const filter: ScopeFilter = {
      ...(selection.traderId === null ? {} : { traderId: selection.traderId }),
      ...(range === null ? {} : range),
    };

    return {
      ...selection,
      filter,
      isNarrowed: Object.keys(filter).length > 0,
      setTraderId: (traderId) => {
        setSelection((current) => ({ ...current, traderId }));
      },
      // Clearing the year clears the month with it: "March of no year" is not
      // a period, and leaving it set would put a month in a dropdown that
      // describes nothing.
      setYear: (year) => {
        setSelection((current) => ({
          ...current,
          year,
          month: year === null ? null : current.month,
        }));
      },
      setMonth: (month) => {
        setSelection((current) => ({ ...current, month }));
      },
    };
  }, [selection]);

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

/**
 * The current selection. Throws outside the provider rather than quietly
 * answering "everything", which would render an unscoped screen inside a
 * scoped application and look exactly like a server that ignored the filter.
 */
export function useScope(): ScopeState {
  const value = useContext(ScopeContext);

  if (value === null) {
    throw new Error('useScope must be used inside <ScopeProvider>');
  }

  return value;
}

/**
 * A year, or a month of one, as the inclusive `from`/`to` the API takes.
 *
 * `Date.UTC(year, month, 0)` is the last day of `month` counting from 1, which
 * is how the leap day is got right without a table. UTC throughout: a local
 * `new Date(2025, 2, 31)` in a behind-UTC zone is the 30th once it reaches the
 * server, and a payout would drop out of the month it belongs to.
 */
export function periodRange(
  year: number | null,
  month: number | null,
): { readonly from: string; readonly to: string } | null {
  if (year === null) return null;

  if (month === null) {
    return { from: `${isoYear(year)}-01-01`, to: `${isoYear(year)}-12-31` };
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    from: `${isoYear(year)}-${pad(month)}-01`,
    to: `${isoYear(year)}-${pad(month)}-${pad(lastDay)}`,
  };
}

function isoYear(year: number): string {
  return String(year).padStart(4, '0');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** January to December, for a dropdown. Index + 1 is the month number. */
export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
