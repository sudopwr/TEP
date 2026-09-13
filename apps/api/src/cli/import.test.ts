import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildContainer } from '../container';
import { openDatabase, type SqliteDatabase } from '../db/connection';

import { main } from './import';

const CSV = path.resolve('apps/api/test/fixtures/tradeify-legacy.csv');

/**
 * `npm run import`, and CLAUDE.md §10 as its result.
 *
 * §14 asks for §10's figures to be confirmed at the end of every task. They
 * are checked in two other places — the domain tests against a hand-built
 * fixture, the end-to-end journeys through a browser — and this is the one
 * that starts where a person actually starts: the spreadsheet they have, run
 * through the command the README tells them to run.
 *
 * Which means it also covers the corrections. Every figure below is only
 * right *because* the importer refused to believe the sheet (§9): the sale
 * amounts were copy-pasted, the exchange fee and GST were in each other's
 * rows, and a reference had already been destroyed by Excel.
 */
describe('npm run import', () => {
  let directory: string;
  let databasePath: string;

  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'payout-import-'));
    databasePath = path.join(directory, 'app.db');
    process.env['PAYOUT_DB'] = databasePath;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    delete process.env['PAYOUT_DB'];
    out.mockClear();
  });

  /** The database the CLI just wrote, opened as the application would. */
  const opened = (): SqliteDatabase => openDatabase(databasePath);

  it('migrates an empty file and imports the sheet', async () => {
    expect(await main([CSV])).toBe(0);

    const said = out.mock.calls.map(([text]) => String(text)).join('');

    expect(said).toContain('Read 13 rows');
    expect(said).toContain('Corrections applied');
  });

  it('is safe to run twice, and says it changed nothing', async () => {
    expect(await main([CSV])).toBe(0);
    out.mockClear();
    expect(await main([CSV])).toBe(0);

    const said = out.mock.calls.map(([text]) => String(text)).join('');

    expect(said).toContain('13 already present');
  });

  it('asks for a file rather than guessing', async () => {
    expect(await main([])).toBe(2);
    expect(out.mock.calls.map(([text]) => String(text)).join('')).toContain(
      'Usage:',
    );
  });

  describe('§10, from the sheet', () => {
    let database: SqliteDatabase;

    beforeEach(async () => {
      expect(await main([CSV])).toBe(0);
      database = opened();
    });

    afterEach(() => {
      database.close();
    });

    it('settles to the figures in the document', async () => {
      const { useCases } = buildContainer(database);
      const settlement = await useCases.getSettlement.execute({ payoutId: 1 });

      expect(settlement.payout.gross.toString()).toBe('1008.01 USD');
      expect(settlement.payout.charges.toString()).toBe('100.79 USD');

      expect(settlement.grossProceeds.toString()).toBe('86027.56 INR');
      expect(settlement.totalFees.toString()).toBe('1384.63 INR');
      expect(settlement.netCredited.toString()).toBe('84642.93 INR');

      // A Map in the domain; the serializer is what turns it into an object.
      expect(settlement.feesByType.get('tds')?.toString()).toBe('868.88 INR');
      expect(settlement.feesByType.get('exchange_fee')?.toString()).toBe(
        '437.09 INR',
      );
      expect(settlement.feesByType.get('gst')?.toString()).toBe('78.66 INR');
    });

    it('leaves the balances the document records', async () => {
      const { useCases } = buildContainer(database);
      const balances = await useCases.getAccountBalances.execute();

      const of = (code: string): string =>
        balances
          .find((entry) => entry.account.code === code)
          ?.balance.toString() ?? 'missing';

      expect(of('bank-hdfc')).toBe('84642.93 INR');
      expect(of('coindcx')).toBe('14.09080000 USDT');
      expect(of('trustwallet')).toBe('1.33230000 USDT');
    });

    it('charges $16.31 in flat network fees across four withdrawals', async () => {
      // §8's complaint, in the data: four withdrawals where one would have
      // cost $4.03.
      const { useCases } = buildContainer(database);
      const legs = await useCases.listTransactions.execute({ payoutId: 1 });
      const trail = await useCases.getPayoutTrail.execute({ payoutId: 1 });

      expect(legs).toHaveLength(13);

      const networkFees: bigint[] = [];
      const walk = (nodes: readonly (typeof trail.roots)[number][]): void => {
        for (const node of nodes) {
          for (const fee of node.fees) {
            if (fee.feeType === 'network_fee') {
              networkFees.push(fee.amount.minor);
            }
          }
          walk(node.children);
        }
      };
      walk(trail.roots);

      expect(networkFees).toHaveLength(4);
      expect(networkFees.reduce((sum, one) => sum + one, 0n)).toBe(1631n);
    });

    it('keeps the reference Excel destroyed, as text (§9 defect 3)', async () => {
      const { useCases } = buildContainer(database);
      const [payout] = await useCases.listPayouts.execute();

      // Unrecoverable, and stored unchanged rather than tidied into something
      // that looks like a reference and is not.
      expect(payout?.reference).toBe('1.43908E+19');
    });
  });
});
