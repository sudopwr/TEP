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
 * **The period is two endpoints, not one year.** A tax year does not start in
 * January: India's runs 1 April to 31 March, so the period a reader actually
 * wants — the one §13's financial-year report already uses — spans two
 * calendar years. A single year-and-month selection cannot say that at all,
 * which is why this holds a first month and a last month instead.
 *
 * Everything defaults to "everything": no trader, no period, so the
 * application opens showing all of it and nothing is hidden until somebody
 * hides it.
 */

/** A month of a year — one end of the period. `month` is 1–12. */
export interface PeriodPoint {
  readonly year: number;
  readonly month: number;
}

export interface ScopeSelection {
  /** The chosen trader, or null for everybody's. */
  readonly traderId: number | null;
  /** The first month shown, or null for all time. */
  readonly from: PeriodPoint | null;
  /** The last month shown, inclusive. Null whenever `from` is. */
  readonly to: PeriodPoint | null;
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
  /**
   * Move an end of the period. Passing null to either clears both, because
   * half a range is not a period the server can be asked for.
   *
   * Each also carries the other end when it has to: an end before its start
   * is not a period either, and the two are corrected here rather than
   * refused, so a reader who picks March and then reaches for the year does
   * not have to undo anything.
   */
  readonly setFrom: (point: PeriodPoint | null) => void;
  readonly setTo: (point: PeriodPoint | null) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

const EVERYTHING: ScopeSelection = { traderId: null, from: null, to: null };

export function ScopeProvider({
  children,
  initial = EVERYTHING,
}: {
  readonly children: ReactNode;
  /** For tests and for a screen that opens already narrowed. */
  readonly initial?: ScopeSelection;
}) {
  const [selection, setSelection] = useState<ScopeSelection>(initial);

  const value = useMemo<ScopeState>(() => {
    const range = periodRange(selection.from, selection.to);
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
      setFrom: (from) => {
        setSelection((current) =>
          from === null
            ? { ...current, from: null, to: null }
            : {
                ...current,
                from,
                // A single month until the other end is moved, and visibly
                // so: both selects show it, rather than one sitting empty
                // while the screen quietly shows everything.
                to:
                  current.to === null || isBefore(current.to, from)
                    ? from
                    : current.to,
              },
        );
      },
      setTo: (to) => {
        setSelection((current) =>
          to === null
            ? { ...current, from: null, to: null }
            : {
                ...current,
                to,
                from:
                  current.from === null || isBefore(to, current.from)
                    ? to
                    : current.from,
              },
        );
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
 * Two months, as the inclusive `from`/`to` the API takes: the first day of
 * the one and the last day of the other.
 *
 * `Date.UTC(year, month, 0)` is the last day of `month` counting from 1,
 * which is how the leap day is got right without a table. UTC throughout: a
 * local `new Date(2025, 2, 31)` in a behind-UTC zone is the 30th once it
 * reaches the server, and a payout would drop out of the month it belongs to.
 */
export function periodRange(
  from: PeriodPoint | null,
  to: PeriodPoint | null,
): { readonly from: string; readonly to: string } | null {
  if (from === null || to === null) return null;

  const [first, last] = isBefore(to, from) ? [to, from] : [from, to];
  const lastDay = new Date(Date.UTC(last.year, last.month, 0)).getUTCDate();

  return {
    from: `${isoYear(first.year)}-${pad(first.month)}-01`,
    to: `${isoYear(last.year)}-${pad(last.month)}-${pad(lastDay)}`,
  };
}

/** Earlier in the calendar, months counted from the year so April 2024 < March 2025. */
export function isBefore(one: PeriodPoint, other: PeriodPoint): boolean {
  return one.year * 12 + one.month < other.year * 12 + other.month;
}

/** How a period reads in a sentence: "April 2024 – March 2025". */
export function describePeriod(
  from: PeriodPoint | null,
  to: PeriodPoint | null,
): string {
  if (from === null || to === null) return 'All time';

  const first = `${MONTH_NAMES[from.month - 1] ?? ''} ${String(from.year)}`;
  const last = `${MONTH_NAMES[to.month - 1] ?? ''} ${String(to.year)}`;

  return first === last ? first : `${first} – ${last}`;
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
