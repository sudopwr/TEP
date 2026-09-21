import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GetAccountBalances,
  GetSettlement,
  ImportLegacyCsv,
  type ImportLegacyCsvResult,
} from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { loadCurrencyRegistry } from './currency-registry';
import { FileCsvReader } from './file-csv-reader';
import { SqliteAccountRepository } from './sqlite-account-repository';
import { SqliteCompanyRepository } from './sqlite-company-repository';
import { SqliteDocumentRepository } from './sqlite-document-repository';
import { SqlitePayoutRepository } from './sqlite-payout-repository';
import { SqliteTransactionRepository } from './sqlite-transaction-repository';

const CSV = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures/tradeify-legacy.csv',
);

/**
 * The whole importer, against the real schema, from the real file.
 *
 * CLAUDE.md §10 is the contract: "Any refactor must still produce these."
 * The sheet this reads is the sheet as it actually is — the four sale rows
 * all say 45.957, Transaction003 and Transaction0011 carry each other's
 * exchange fee and GST, the platform reference is already a float, the dates
 * are DD-MM-YYYY, and there are two columns called ToAmount. The figures
 * below only appear if every one of those is corrected on the way in.
 */
describe('ImportLegacyCsv against a real database', () => {
  let database: SqliteDatabase;

  const build = () => {
    const currencies = loadCurrencyRegistry(database);
    const transactions = new SqliteTransactionRepository(database, currencies);
    const accounts = new SqliteAccountRepository(database);
    const payouts = new SqlitePayoutRepository(database, currencies);
    const documents = new SqliteDocumentRepository(database);

    return {
      currencies,
      transactions,
      accounts,
      payouts,
      documents,
      importer: new ImportLegacyCsv({
        csv: new FileCsvReader(),
        companies: new SqliteCompanyRepository(database),
        accounts,
        payouts,
        transactions,
        documents,
        currencies,
      }),
    };
  };

  const runImport = async (): Promise<ImportLegacyCsvResult> =>
    build().importer.execute({ location: CSV, traderId: 1 });

  beforeEach(() => {
    database = openTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('reads every row of the sheet', async () => {
    const result = await runImport();

    expect(result.rowsRead).toBe(13);
    expect(result.transactions).toEqual({ created: 13, reused: 0 });
    expect(result.payouts).toEqual({ created: 1, reused: 12 });
    expect(result.companies).toEqual({ created: 1, reused: 12 });
  });

  describe('CLAUDE.md §10 — the verified reference figures', () => {
    beforeEach(async () => {
      await runImport();
    });

    it('produces the settlement figures exactly', async () => {
      const { payouts, transactions, accounts, currencies } = build();
      const settlement = await new GetSettlement({
        payouts,
        transactions,
        accounts,
        currencies,
      }).execute({ payoutId: 1 });

      expect(settlement.payout.gross.toDecimalString()).toBe('1008.01');
      expect(settlement.grossProceeds.toDecimalString()).toBe('86027.56');
      expect(settlement.totalFees.toDecimalString()).toBe('1384.63');
      expect(settlement.netCredited.toDecimalString()).toBe('84642.93');
    });

    it('produces the fee breakdown exactly', async () => {
      const { payouts, transactions, accounts, currencies } = build();
      const inr = await new GetSettlement({
        payouts,
        transactions,
        accounts,
        currencies,
      }).execute({ payoutId: 1, settlementCurrencyCode: 'INR' });
      const usd = await new GetSettlement({
        payouts,
        transactions,
        accounts,
        currencies,
      }).execute({ payoutId: 1, settlementCurrencyCode: 'USD' });

      expect(inr.feesByType.get('tds')?.toDecimalString()).toBe('868.88');
      expect(inr.feesByType.get('exchange_fee')?.toDecimalString()).toBe(
        '437.09',
      );
      expect(inr.feesByType.get('gst')?.toDecimalString()).toBe('78.66');
      expect(usd.feesByType.get('network_fee')?.toDecimalString()).toBe(
        '16.31',
      );
    });

    it('records the platform charge on the payout', async () => {
      const { payouts } = build();
      const payout = await payouts.findByCode('TradeifyPayout001');

      expect(payout?.charges.toDecimalString()).toBe('100.79');
    });

    it('produces all three balances exactly, dust included', async () => {
      const { accounts, transactions, payouts } = build();
      const balances = await new GetAccountBalances({
        accounts,
        transactions,
        payouts,
      }).execute({});

      const find = (code: string, currency: string) =>
        balances.find(
          (row) => row.account.code === code && row.currency.code === currency,
        )?.balance;

      expect(find('bank-hdfc', 'INR')?.toDecimalString()).toBe('84642.93');
      expect(find('coindcx', 'USDT')?.toDecimalString()).toBe('14.09080000');
      expect(find('trustwallet', 'USDT')?.toDecimalString()).toBe('1.33230000');
    });

    it('leaves the dust as exact minor units, not a rounded display', async () => {
      const { accounts, transactions, payouts } = build();
      const balances = await new GetAccountBalances({
        accounts,
        transactions,
        payouts,
      }).execute({});

      const dust = (code: string) =>
        balances.find((row) => row.account.code === code)?.balance.minor;

      expect(dust('coindcx')).toBe(1409080000n);
      expect(dust('trustwallet')).toBe(133230000n);
    });
  });

  describe('the §9 corrections', () => {
    beforeEach(async () => {
      await runImport();
    });

    it('discards the copy-pasted 45.957 on every sale row', async () => {
      const { transactions } = build();
      const sales = (await transactions.listByPayout(1)).filter((leg) =>
        leg.isSale(),
      );

      expect(sales).toHaveLength(4);
      for (const sale of sales) {
        expect(sale.fromAmount.toDecimalString()).not.toBe('45.95700000');
      }
    });

    it('recovers Transaction0011 as 741.72, not 45.957', async () => {
      const { transactions } = build();
      const sale = await transactions.findByCode('Transaction0011');

      expect(sale?.fromAmount.toDecimalString()).toBe('741.72000000');
    });

    it('recomputes each sale from its own proceeds and rate', async () => {
      const { transactions } = build();
      const byCode = new Map(
        (await transactions.listByPayout(1)).map((leg) => [leg.code, leg]),
      );

      expect(byCode.get('Transaction003')?.fromAmount.toDecimalString()).toBe(
        '45.00000000',
      );
      expect(byCode.get('Transaction005')?.fromAmount.toDecimalString()).toBe(
        '44.00000000',
      );
      expect(byCode.get('Transaction008')?.fromAmount.toDecimalString()).toBe(
        '44.76690000',
      );
    });

    it('un-swaps the exchange fee and GST between the two sale rows', async () => {
      const { transactions } = build();
      const three = await transactions.findByCode('Transaction003');
      const eleven = await transactions.findByCode('Transaction0011');
      if (three === null || eleven === null) throw new Error('missing');

      const feesOf = async (id: number) =>
        new Map(
          (await transactions.listFeesByTransaction(id)).map((fee) => [
            fee.feeType,
            fee.amount.toDecimalString(),
          ]),
        );

      // The sheet had these the other way round.
      expect((await feesOf(three.id)).get('exchange_fee')).toBe('22.47');
      expect((await feesOf(three.id)).get('gst')).toBe('4.04');
      expect((await feesOf(eleven.id)).get('exchange_fee')).toBe('370.19');
      expect((await feesOf(eleven.id)).get('gst')).toBe('66.62');
    });

    it('leaves both corrected fees at roughly 0.508% of proceeds', async () => {
      const { transactions } = build();

      for (const code of ['Transaction003', 'Transaction0011']) {
        const leg = await transactions.findByCode(code);
        if (leg === null) throw new Error('missing');
        const fees = await transactions.listFeesByTransaction(leg.id);
        const exchange = fees.find((fee) => fee.feeType === 'exchange_fee');
        if (exchange === undefined) throw new Error('missing fee');

        // basis points, to one decimal: 50.8 bps either side.
        const bps =
          Number((exchange.amount.minor * 100000n) / leg.toAmount.minor) / 10;
        expect(bps).toBeCloseTo(50.8, 0);
      }
    });

    it('keeps the reference Excel destroyed, verbatim and as text', async () => {
      const { payouts } = build();
      const payout = await payouts.findByCode('TradeifyPayout001');

      expect(payout?.reference).toBe('1.43908E+19');
    });

    it('keeps every transaction reference as text', async () => {
      const { transactions } = build();
      const credit = await transactions.findByCode('Transaction001');
      const sale = await transactions.findByCode('Transaction0011');

      expect(credit?.fromExternalRef).toBe('TDFY-AWARD-88121');
      expect(sale?.toExternalRef).toBe('HDFC-NEFT-3344');
    });

    it('parses DD-MM-YYYY into ISO', async () => {
      const { transactions, payouts } = build();
      const payout = await payouts.findByCode('TradeifyPayout001');
      const sale = await transactions.findByCode('Transaction0011');

      expect(payout?.payoutDate).toBe('2025-03-10');
      // 20-03-2025 is the twentieth of March, not the third of August.
      expect(sale?.txnDate).toBe('2025-03-20');
    });

    it('reads the first ToAmount column as the from-side', async () => {
      const { transactions } = build();
      const credit = await transactions.findByCode('Transaction001');

      // Row reads ... 1008.01, USD, 907.22, USD ...
      expect(credit?.fromAmount.toDecimalString()).toBe('1008.01');
      expect(credit?.toAmount.toDecimalString()).toBe('907.22');
    });

    it('builds the tree from codes, not from how the ids sort', async () => {
      const { transactions } = build();
      // 'Transaction0010' sorts before 'Transaction002' as text, and appears
      // below it in the file. Its parent still resolves.
      const ten = await transactions.findByCode('Transaction0010');
      const six = await transactions.findByCode('Transaction006');

      expect(ten?.parentId).toBe(six?.id);
      expect(ten?.id).toBeGreaterThan(six?.id ?? 0);
    });
  });

  describe('the corrections it reports', () => {
    it('names every defect it corrected', async () => {
      const result = await runImport();
      const defects = new Set(result.corrections.map((one) => one.defect));

      // Defects 1-4 are corrections applied to data. Defect 5 — ids that sort
      // badly as text — is not corrected so much as never relied on: the
      // importer reads rows in file order and resolves parents by code, so
      // there is nothing to report.
      expect(defects).toEqual(new Set([1, 2, 3, 4]));
    });

    it('names all four sale rows in the recomputation notes', async () => {
      const result = await runImport();
      const recomputed = result.corrections
        .filter((one) => one.defect === 1)
        .map((one) => one.subject);

      expect(recomputed).toEqual([
        'Transaction003',
        'Transaction005',
        'Transaction008',
        'Transaction0011',
      ]);
    });

    it('reports the duplicate ToAmount header once', async () => {
      const result = await runImport();
      const duplicates = result.corrections.filter((one) => one.defect === 4);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.subject).toBe('ToAmount');
    });

    it('reports nothing on a second run, having nothing left to correct', async () => {
      await runImport();
      const second = await runImport();

      expect(second.corrections.filter((one) => one.defect === 1)).toEqual([]);
    });
  });

  describe('documents', () => {
    beforeEach(async () => {
      await runImport();
    });

    it('splits the comma-separated lists and dedupes by filename', async () => {
      const result = await build().importer.execute({ location: CSV, traderId: 1 });

      // coindcx-march.pdf is named by four rows, tradeify-payout-001.pdf by
      // two. Eleven distinct files, sixteen links.
      expect(result.documents.created + result.documents.reused).toBe(16);
      expect(result.documentLinks).toBe(16);
    });

    it('holds one row per distinct filename', async () => {
      const { documents } = build();
      const shared = await documents.findByStoredPath(
        'legacy/coindcx-march.pdf',
      );

      expect(shared).not.toBeNull();
      expect(shared?.filename).toBe('coindcx-march.pdf');
    });

    it('links the shared statement to all four sale legs', async () => {
      const { documents, transactions } = build();
      const shared = await documents.findByStoredPath(
        'legacy/coindcx-march.pdf',
      );
      if (shared === null) throw new Error('missing');

      const sales = (await transactions.listByPayout(1)).filter((leg) =>
        leg.isSale(),
      );

      for (const sale of sales) {
        const attached = await documents.listForTarget({
          kind: 'transaction',
          id: sale.id,
        });
        expect(attached.map((one) => one.id)).toContain(shared.id);
      }
    });

    it('records a filename with no content hash until the file arrives', async () => {
      const { documents } = build();
      const listed = await documents.findByStoredPath(
        'legacy/coindcx-march.pdf',
      );

      expect(listed?.sha256).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('a second run inserts nothing', async () => {
      const first = await runImport();
      const second = await runImport();

      expect(first.transactions.created).toBe(13);
      expect(second.transactions.created).toBe(0);
      expect(second.transactions.reused).toBe(13);
      expect(second.payouts.created).toBe(0);
      expect(second.documents.created).toBe(0);
    });

    it('leaves the row counts unchanged', async () => {
      await runImport();
      const { transactions, documents } = build();
      const before = {
        legs: (await transactions.list()).length,
        fees: (await transactions.listFees()).length,
        docs: (await documents.listForTarget({ kind: 'transaction', id: 1 }))
          .length,
      };

      await runImport();

      expect((await transactions.list()).length).toBe(before.legs);
      expect((await transactions.listFees()).length).toBe(before.fees);
      expect(
        (await documents.listForTarget({ kind: 'transaction', id: 1 })).length,
      ).toBe(before.docs);
    });

    it('still produces the §10 figures after running twice', async () => {
      await runImport();
      await runImport();

      const { payouts, transactions, accounts, currencies } = build();
      const settlement = await new GetSettlement({
        payouts,
        transactions,
        accounts,
        currencies,
      }).execute({ payoutId: 1 });

      expect(settlement.netCredited.toDecimalString()).toBe('84642.93');
    });

    it('resumes after a run that stopped half way', async () => {
      // A crash mid-import is the normal failure, not a hypothetical one.
      const { payouts, companies } = {
        ...build(),
        companies: new SqliteCompanyRepository(database),
      };
      const company = await companies.insert({
        code: 'Tradeify001',
        name: 'Tradeify',
        notes: null,
      });
      await payouts.insert({
        code: 'TradeifyPayout001',
        companyId: company.id,
        traderId: 1,
        payoutDate: '2025-03-10',
        reference: '1.43908E+19',
        gross: (await import('@payout/core')).Money.fromDecimalString(
          '1008.01',
          loadCurrencyRegistry(database).get('USD'),
        ),
        charges: (await import('@payout/core')).Money.fromDecimalString(
          '100.79',
          loadCurrencyRegistry(database).get('USD'),
        ),
        notes: null,
      });

      const result = await runImport();

      expect(result.payouts.created).toBe(0);
      expect(result.transactions.created).toBe(13);
    });
  });
});
