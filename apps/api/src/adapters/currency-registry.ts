import { CurrencyRegistry } from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

const SQL = {
  selectAll: 'SELECT code, scale FROM currencies ORDER BY code',
} as const;

interface CurrencyRow {
  readonly code: string;
  readonly scale: bigint;
}

/**
 * Build the domain's currency registry from the `currencies` table.
 *
 * CLAUDE.md §6 says the scale lives in the table, so this is the only place
 * that decides INR is two decimal places and USDT is eight. The registry the
 * domain exports as a convenience is a development default; everything that
 * touches a real database reads its scales from the database, and adding a
 * currency is an INSERT rather than a release.
 */
export function loadCurrencyRegistry(
  database: SqliteDatabase,
): CurrencyRegistry {
  const rows = database.prepare<[], CurrencyRow>(SQL.selectAll).all();

  return new CurrencyRegistry(
    rows.map((row) => ({ code: row.code, scale: Number(row.scale) })),
  );
}
