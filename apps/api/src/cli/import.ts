import path from 'node:path';
import process from 'node:process';

import type { ImportLegacyCsvResult } from '@payout/core';

import { buildContainer } from '../container';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';

const USAGE = `
Usage: npm run import -- <path-to.csv>

Reads the legacy payout sheet and writes it into data/app.db, correcting
the defects recorded in CLAUDE.md section 9 on the way in. Safe to run more
than once: every row is keyed by the code the sheet already gives it, so a
second run reports what it found and inserts nothing.

Environment:
  PAYOUT_DB   database file to write (default: data/app.db)
`.trim();

function describe(result: ImportLegacyCsvResult): string {
  const line = (label: string, tally: { created: number; reused: number }) =>
    `  ${label.padEnd(14)} ${String(tally.created).padStart(4)} created` +
    `  ${String(tally.reused).padStart(4)} already present`;

  const lines = [
    `Read ${String(result.rowsRead)} rows.`,
    '',
    line('companies', result.companies),
    line('accounts', result.accounts),
    line('payouts', result.payouts),
    line('transactions', result.transactions),
    line('documents', result.documents),
    `  ${'fees'.padEnd(14)} ${String(result.feesRecorded).padStart(4)} recorded`,
    `  ${'links'.padEnd(14)} ${String(result.documentLinks).padStart(4)} written`,
  ];

  if (result.corrections.length > 0) {
    lines.push('', 'Corrections applied (CLAUDE.md section 9):');
    for (const correction of result.corrections) {
      lines.push(
        `  [defect ${String(correction.defect)}] ${correction.subject}`,
        `      ${correction.detail}`,
      );
    }
  } else {
    lines.push('', 'Nothing to correct — every row was already imported.');
  }

  return lines.join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  const [location] = argv;

  if (location === undefined || location === '--help' || location === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return location === undefined ? 2 : 0;
  }

  const databasePath =
    process.env['PAYOUT_DB'] ?? path.resolve('data', 'app.db');

  const database = openDatabase(databasePath);

  try {
    const applied = migrate(database);
    if (applied.applied.length > 0) {
      process.stdout.write(
        `Applied ${String(applied.applied.length)} migration(s) to ${databasePath}\n\n`,
      );
    }

    // The same wiring the server uses. §5 keeps adapter assembly in one file,
    // and a CLI that built its own would be a second copy to keep in step.
    const { importLegacyCsv } = buildContainer(database);

    const result = await importLegacyCsv.execute({ location });

    process.stdout.write(`${describe(result)}\n`);
    return 0;
  } catch (error) {
    // The import is one transaction's worth of trust in a spreadsheet. When
    // it refuses a row, the row and column are the whole message.
    process.stderr.write(`Import failed: ${(error as Error).message}\n`);
    return 1;
  } finally {
    database.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined;

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
