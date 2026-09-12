import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import { useMemo, useState, type ReactNode } from 'react';

import { EmptyState } from './EmptyState';

/**
 * A table, generic over its row type. It fetches nothing and knows nothing
 * about what a row means.
 *
 * ```tsx
 * interface Balance { id: number; name: string; minor: string; currency: string }
 *
 * <DataTable<Balance>
 *   rows={balances}
 *   rowKey={(row) => row.id}
 *   columns={[
 *     { id: 'name', header: 'Account', cell: (row) => row.name, sortBy: (row) => row.name },
 *     {
 *       id: 'balance',
 *       header: 'Balance',
 *       align: 'right',
 *       cell: (row) => <MoneyDisplay minor={row.minor} currency={row.currency} />,
 *       // Sorted by the integer, never by the formatted string: "9" sorts
 *       // after "84,642.93" as text.
 *       sortBy: (row) => BigInt(row.minor),
 *     },
 *   ]}
 * />
 *
 * <DataTable rows={[]} rowKey={(r) => r.id} columns={cols} loading />
 * <DataTable rows={[]} rowKey={(r) => r.id} columns={cols}
 *            empty={{ message: 'No accounts yet.', action: { label: 'Add one', onClick: add } }} />
 * ```
 */

/** What a cell may sort on. BigInt is here so money sorts as a number. */
export type SortValue = string | number | bigint | boolean | null | undefined;

export interface Column<Row> {
  /** Stable identity for the column, used as the sort key. */
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  /**
   * Return the value this column sorts on. Omit and the column is not
   * sortable — which is the right answer for a column of buttons.
   *
   * Deliberately separate from `cell`: sorting a money column by its rendered
   * string puts `9.00` after `84,642.93`, and sorting a date column by
   * `'12 Mar'` is alphabetical by month name.
   */
  readonly sortBy?: (row: Row) => SortValue;
  readonly align?: 'left' | 'right' | 'center';
  readonly width?: number | string;
}

export interface DataTableProps<Row> {
  readonly rows: readonly Row[];
  readonly columns: readonly Column<Row>[];
  /** A stable key per row. Index would reorder wrongly on sort. */
  readonly rowKey: (row: Row) => string | number;
  readonly loading?: boolean;
  /** Rows of skeleton to show while loading. */
  readonly loadingRows?: number;
  readonly empty?: {
    readonly message: string;
    readonly hint?: string;
    readonly action?: { readonly label: string; readonly onClick: () => void };
  };
  readonly caption?: string;
  readonly onRowClick?: (row: Row) => void;
  readonly initialSort?: {
    readonly columnId: string;
    readonly direction: SortDirection;
  };
}

export type SortDirection = 'asc' | 'desc';

type Present = NonNullable<SortValue>;

/**
 * Compare two present values without coercing either to a float.
 *
 * `bigint` is compared as a bigint, so a balance in paise sorts correctly at
 * any magnitude. Strings use `localeCompare` so `Ä` lands next to `A` rather
 * than after `Z`.
 */
function compare(left: Present, right: Present): number {
  if (left === right) return 0;

  if (typeof left === 'bigint' && typeof right === 'bigint') {
    return left < right ? -1 : 1;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

/**
 * Order two rows, with absent values pinned to the bottom.
 *
 * The nullish check sits *outside* the direction multiplier deliberately. If
 * it were inside `compare`, reversing the sort would reverse it too and a
 * column of blanks would jump to the top — which reads as "these are the
 * smallest", when what it means is "these are missing". Missing belongs at
 * the end whichever way the arrow points.
 */
function orderBy(
  left: SortValue,
  right: SortValue,
  direction: SortDirection,
): number {
  const leftAbsent = left === null || left === undefined;
  const rightAbsent = right === null || right === undefined;

  if (leftAbsent && rightAbsent) return 0;
  if (leftAbsent) return 1;
  if (rightAbsent) return -1;

  return (direction === 'asc' ? 1 : -1) * compare(left, right);
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading = false,
  loadingRows = 3,
  empty,
  caption,
  onRowClick,
  initialSort,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{
    columnId: string;
    direction: SortDirection;
  } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (sort === null) return rows;

    const column = columns.find((one) => one.id === sort.columnId);
    if (column?.sortBy === undefined) return rows;

    const by = column.sortBy;
    const { direction } = sort;

    // A copy: sorting the caller's array in place would mutate a prop.
    return [...rows].sort((left, right) =>
      orderBy(by(left), by(right), direction),
    );
  }, [rows, columns, sort]);

  const toggle = (columnId: string): void => {
    setSort((current) =>
      current?.columnId === columnId
        ? {
            columnId,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          }
        : { columnId, direction: 'asc' },
    );
  };

  // Empty and loading are different states and must not be conflated: an
  // empty table during a load says "there is nothing", which is a lie that
  // arrives before the truth.
  if (!loading && rows.length === 0 && empty !== undefined) {
    return (
      <EmptyState
        message={empty.message}
        {...(empty.hint === undefined ? {} : { hint: empty.hint })}
        {...(empty.action === undefined ? {} : { action: empty.action })}
      />
    );
  }

  return (
    <Table
      size="small"
      {...(caption === undefined ? {} : { 'aria-label': caption })}
    >
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableCell
              key={column.id}
              align={column.align ?? 'left'}
              {...(column.width === undefined
                ? {}
                : { style: { width: column.width } })}
              {...(sort?.columnId === column.id
                ? {
                    'aria-sort':
                      sort.direction === 'asc'
                        ? ('ascending' as const)
                        : ('descending' as const),
                  }
                : {})}
            >
              {column.sortBy === undefined ? (
                column.header
              ) : (
                <TableSortLabel
                  active={sort?.columnId === column.id}
                  direction={
                    sort?.columnId === column.id ? sort.direction : 'asc'
                  }
                  onClick={() => {
                    toggle(column.id);
                  }}
                >
                  {column.header}
                </TableSortLabel>
              )}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>

      <TableBody>
        {loading
          ? Array.from({ length: loadingRows }, (_unused, index) => (
              <TableRow key={`skeleton-${String(index)}`}>
                {columns.map((column) => (
                  <TableCell key={column.id} align={column.align ?? 'left'}>
                    <Skeleton
                      variant="text"
                      // A fixed width per column rather than a random one:
                      // a skeleton that changes width on every render reads
                      // as motion, and motion reads as progress that is not
                      // happening.
                      width={column.align === 'right' ? 72 : 120}
                      aria-hidden
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : sorted.map((row) => (
              <TableRow
                key={rowKey(row)}
                {...(onRowClick === undefined
                  ? {}
                  : {
                      hover: true,
                      onClick: () => {
                        onRowClick(row);
                      },
                      sx: { cursor: 'pointer' },
                    })}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} align={column.align ?? 'left'}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
