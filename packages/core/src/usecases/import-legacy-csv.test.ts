import { describe, expect, it } from 'vitest';

import { FakeCsvReader } from '../../test/fakes/fake-csv-reader';
import { TestWorld } from '../../test/fakes/world';

import {
  ImportLegacyCsv,
  LegacyCsvError,
  toIsoDate,
  toScaledRate,
} from './import-legacy-csv';

/**
 * A miniature sheet with the same shape as the real one: two columns called
 * ToAmount, DD-MM-YYYY dates, and every sale row carrying the copy-pasted
 * 45.957 that CLAUDE.md §9 says to throw away.
 */
const HEADERS = [
  'TxnId',
  'ParentId',
  'PayoutCode',
  'PayoutCurrency',
  'PayoutDate',
  'PayoutGross',
  'PayoutCharges',
  'PayoutRef',
  'CompanyCode',
  'CompanyName',
  'Date',
  'Kind',
  'FromAccount',
  'FromAccountName',
  'FromAccountType',
  'ToAccount',
  'ToAccountName',
  'ToAccountType',
  'ToAmount',
  'FromCurrency',
  'ToAmount',
  'ToCurrency',
  'Rate',
  'FromRef',
  'ToRef',
  'TDS',
  'ExchangeFee',
  'GST',
  'NetworkFee',
  'Documents',
];

const PAYOUT = [
  'TradeifyPayout001',
  'USD',
  '10-03-2025',
  '1008.01',
  '100.79',
  '1.43908E+19',
  'Tradeify001',
  'Tradeify',
];

interface RowOptions {
  readonly txn: string;
  readonly parent?: string;
  readonly date?: string;
  readonly kind: string;
  readonly from: readonly [string, string, string];
  readonly to: readonly [string, string, string];
  readonly fromAmount: string;
  readonly fromCurrency: string;
  readonly toAmount: string;
  readonly toCurrency: string;
  readonly rate?: string;
  readonly tds?: string;
  readonly exchangeFee?: string;
  readonly gst?: string;
  readonly networkFee?: string;
  readonly documents?: string;
}

const CDX = ['coindcx', 'CoinDCX', 'exchange'] as const;
const BANK = ['bank-hdfc', 'HDFC', 'bank'] as const;
const WALLET = ['trustwallet', 'TrustWallet', 'wallet'] as const;

const row = (options: RowOptions): readonly string[] => [
  options.txn,
  options.parent ?? '',
  ...PAYOUT,
  options.date ?? '16-03-2025',
  options.kind,
  ...options.from,
  ...options.to,
  options.fromAmount,
  options.fromCurrency,
  options.toAmount,
  options.toCurrency,
  options.rate ?? '',
  'FROM-REF-1',
  'TO-REF-1',
  options.tds ?? '',
  options.exchangeFee ?? '',
  options.gst ?? '',
  options.networkFee ?? '',
  options.documents ?? '',
];

const SALE = {
  txn: 'Transaction003',
  kind: 'sale',
  from: CDX,
  to: BANK,
  fromAmount: '45.957',
  fromCurrency: 'USDT',
  toAmount: '4423.50',
  toCurrency: 'INR',
  rate: '98.30',
} as const;

const setup = (rows: readonly (readonly string[])[]) => {
  const world = TestWorld.withCounterparties();
  const useCase = new ImportLegacyCsv({
    csv: FakeCsvReader.of(HEADERS, rows),
    companies: world.companies,
    accounts: world.accounts,
    payouts: world.payouts,
    transactions: world.transactions,
    documents: world.documents,
    currencies: world.currencies,
  });

  return { world, useCase };
};

const run = async (rows: readonly (readonly string[])[]) => {
  const { world, useCase } = setup(rows);
  const result = await useCase.execute({ location: 'legacy.csv' });
  return { world, useCase, result };
};

describe('toIsoDate', () => {
  it('reads DD-MM-YYYY, not MM-DD-YYYY', () => {
    expect(toIsoDate('02-04-2025')).toBe('2025-04-02');
    expect(toIsoDate('20-03-2025')).toBe('2025-03-20');
  });

  it('refuses anything else', () => {
    expect(toIsoDate('2025-03-20')).toBeNull();
    expect(toIsoDate('2-4-2025')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('toScaledRate', () => {
  it('scales to 1e8 whatever precision the sheet used', () => {
    expect(toScaledRate('98.25')).toBe(9825000000n);
    expect(toScaledRate('98.44483312')).toBe(9844483312n);
    expect(toScaledRate('1')).toBe(100000000n);
  });

  it('is null for a blank cell and for nonsense', () => {
    expect(toScaledRate('')).toBeNull();
    expect(toScaledRate('  ')).toBeNull();
    expect(toScaledRate('n/a')).toBeNull();
  });
});

describe('ImportLegacyCsv (F12)', () => {
  describe('§9 defect 1 — the copy-pasted from-amount', () => {
    it('recomputes a sale from its proceeds and rate', async () => {
      const { world } = await run([row(SALE)]);
      const sale = await world.transactions.findByCode('Transaction003');

      // 4423.50 / 98.30 = 45.00 exactly, not the 45.957 in the cell.
      expect(sale?.fromAmount.toDecimalString()).toBe('45.00000000');
    });

    it('recovers 741.72 for the row §9 names', async () => {
      const { world } = await run([
        row({
          ...SALE,
          txn: 'Transaction0011',
          toAmount: '72873.99',
          rate: '98.25',
        }),
      ]);

      expect(
        (
          await world.transactions.findByCode('Transaction0011')
        )?.fromAmount.toDecimalString(),
      ).toBe('741.72000000');
    });

    it('trusts the from-amount on a leg that is not a sale', async () => {
      const { world } = await run([
        row({
          txn: 'Transaction007',
          kind: 'transfer',
          from: WALLET,
          to: CDX,
          fromAmount: '222.44',
          fromCurrency: 'USDT',
          toAmount: '222.44',
          toCurrency: 'USDT',
        }),
      ]);

      expect(
        (
          await world.transactions.findByCode('Transaction007')
        )?.fromAmount.toDecimalString(),
      ).toBe('222.44000000');
    });

    it('reports what it discarded and what it used instead', async () => {
      const { result } = await run([row(SALE)]);
      const correction = result.corrections.find((one) => one.defect === 1);

      expect(correction?.subject).toBe('Transaction003');
      expect(correction?.detail).toContain('45.95700000');
      expect(correction?.detail).toContain('45.00000000');
    });

    it('refuses a sale with no rate to divide by', async () => {
      await expect(run([row({ ...SALE, rate: '' })])).rejects.toThrow(
        LegacyCsvError,
      );
    });

    it('honours an explicit rounding mode', async () => {
      // 4407.07 / 98.44483312 does not divide evenly.
      const toward = await run([
        row({ ...SALE, toAmount: '4407.07', rate: '98.44483312' }),
      ]).then(async ({ world }) =>
        (
          await world.transactions.findByCode('Transaction003')
        )?.fromAmount.toDecimalString(),
      );

      expect(toward).toBe('44.76690000');
    });
  });

  describe('§9 defect 2 — the swapped exchange fee and GST', () => {
    const pair = [
      row({
        ...SALE,
        txn: 'Transaction003',
        exchangeFee: '370.19',
        gst: '66.62',
      }),
      row({
        ...SALE,
        txn: 'Transaction0011',
        toAmount: '72873.99',
        rate: '98.25',
        exchangeFee: '22.47',
        gst: '4.04',
      }),
    ];

    it('gives each row the other row’s pair', async () => {
      const { world } = await run(pair);

      const three = await world.transactions.findByCode('Transaction003');
      const eleven = await world.transactions.findByCode('Transaction0011');
      if (three === null || eleven === null) throw new Error('missing');

      const feesOf = async (id: number) =>
        new Map(
          (await world.transactions.listFeesByTransaction(id)).map((fee) => [
            fee.feeType,
            fee.amount.toDecimalString(),
          ]),
        );

      expect((await feesOf(three.id)).get('exchange_fee')).toBe('22.47');
      expect((await feesOf(three.id)).get('gst')).toBe('4.04');
      expect((await feesOf(eleven.id)).get('exchange_fee')).toBe('370.19');
      expect((await feesOf(eleven.id)).get('gst')).toBe('66.62');
    });

    it('leaves TDS where it was — only two columns were swapped', async () => {
      const { world } = await run([
        row({ ...SALE, tds: '44.68', exchangeFee: '370.19', gst: '66.62' }),
        row({
          ...SALE,
          txn: 'Transaction0011',
          toAmount: '72873.99',
          rate: '98.25',
          tds: '736.03',
          exchangeFee: '22.47',
          gst: '4.04',
        }),
      ]);

      const three = await world.transactions.findByCode('Transaction003');
      if (three === null) throw new Error('missing');
      const fees = await world.transactions.listFeesByTransaction(three.id);

      expect(
        fees.find((fee) => fee.feeType === 'tds')?.amount.toDecimalString(),
      ).toBe('44.68');
    });

    it('does nothing when only one of the pair is present', async () => {
      const { world, result } = await run([
        row({ ...SALE, exchangeFee: '370.19', gst: '66.62' }),
      ]);

      const three = await world.transactions.findByCode('Transaction003');
      if (three === null) throw new Error('missing');
      const fees = await world.transactions.listFeesByTransaction(three.id);

      expect(
        fees
          .find((fee) => fee.feeType === 'exchange_fee')
          ?.amount.toDecimalString(),
      ).toBe('370.19');
      expect(result.corrections.some((one) => one.defect === 2)).toBe(false);
    });
  });

  describe('§9 defect 3 — references stay text', () => {
    it('keeps the reference Excel turned into a float', async () => {
      const { world } = await run([row(SALE)]);
      const payout = await world.payouts.findByCode('TradeifyPayout001');

      expect(payout?.reference).toBe('1.43908E+19');
    });

    it('flags it as unrecoverable rather than silently keeping it', async () => {
      const { result } = await run([row(SALE)]);
      const correction = result.corrections.find((one) => one.defect === 3);

      expect(correction?.detail).toContain('unrecoverable');
    });

    it('carries both transaction references across', async () => {
      const { world } = await run([row(SALE)]);
      const sale = await world.transactions.findByCode('Transaction003');

      expect(sale?.fromExternalRef).toBe('FROM-REF-1');
      expect(sale?.toExternalRef).toBe('TO-REF-1');
    });
  });

  describe('§9 defect 4 — the duplicate ToAmount header', () => {
    it('reads the first occurrence as the from-side', async () => {
      const { world } = await run([
        row({
          txn: 'Transaction001',
          kind: 'transfer',
          from: WALLET,
          to: CDX,
          fromAmount: '222.44',
          fromCurrency: 'USDT',
          toAmount: '111.11',
          toCurrency: 'USDT',
        }),
      ]);

      const leg = await world.transactions.findByCode('Transaction001');
      expect(leg?.fromAmount.toDecimalString()).toBe('222.44000000');
      expect(leg?.toAmount.toDecimalString()).toBe('111.11000000');
    });

    it('reports the duplicate so nobody has to notice it twice', async () => {
      const { result } = await run([row(SALE)]);
      const correction = result.corrections.find((one) => one.defect === 4);

      expect(correction?.subject).toBe('ToAmount');
    });
  });

  describe('§9 defect 5 — ids that sort badly as text', () => {
    it('resolves a parent that sorts before its child', async () => {
      const { world } = await run([
        row({
          txn: 'Transaction002',
          kind: 'transfer',
          from: WALLET,
          to: CDX,
          fromAmount: '222.44',
          fromCurrency: 'USDT',
          toAmount: '222.44',
          toCurrency: 'USDT',
        }),
        row({
          txn: 'Transaction0010',
          parent: 'Transaction002',
          kind: 'transfer',
          from: WALLET,
          to: CDX,
          fromAmount: '222.37',
          fromCurrency: 'USDT',
          toAmount: '222.37',
          toCurrency: 'USDT',
        }),
      ]);

      const parent = await world.transactions.findByCode('Transaction002');
      const child = await world.transactions.findByCode('Transaction0010');

      expect(child?.parentId).toBe(parent?.id);
    });

    it('keeps the sheet id as the code and numbers the rows itself', async () => {
      const { world } = await run([row(SALE)]);
      const sale = await world.transactions.findByCode('Transaction003');

      expect(sale?.code).toBe('Transaction003');
      expect(typeof sale?.id).toBe('number');
    });

    it('refuses a parent that has not appeared yet', async () => {
      await expect(
        run([row({ ...SALE, parent: 'Transaction999' })]),
      ).rejects.toThrow(LegacyCsvError);
    });
  });

  describe('documents', () => {
    it('splits a comma-separated list into one link each', async () => {
      const { world, result } = await run([
        row({ ...SALE, documents: 'a.pdf, b.pdf , c.pdf' }),
      ]);

      expect(result.documentLinks).toBe(3);
      expect(world.documents.documentCount()).toBe(3);
    });

    it('dedupes by filename across rows', async () => {
      const { world, result } = await run([
        row({ ...SALE, documents: 'shared.pdf' }),
        row({
          ...SALE,
          txn: 'Transaction005',
          documents: 'shared.pdf, other.pdf',
        }),
      ]);

      expect(world.documents.documentCount()).toBe(2);
      expect(result.documentLinks).toBe(3);
    });

    it('dedupes a filename repeated inside one cell', async () => {
      const { world, result } = await run([
        row({ ...SALE, documents: 'same.pdf, same.pdf' }),
      ]);

      expect(world.documents.documentCount()).toBe(1);
      expect(result.documentLinks).toBe(1);
    });

    it('ignores an empty list and stray separators', async () => {
      const { world, result } = await run([
        row({ ...SALE, documents: ' , ,' }),
      ]);

      expect(world.documents.documentCount()).toBe(0);
      expect(result.documentLinks).toBe(0);
    });

    it('records the filename with no content hash yet', async () => {
      const { world } = await run([row({ ...SALE, documents: 'a.pdf' })]);
      const document = await world.documents.findByStoredPath('legacy/a.pdf');

      expect(document?.filename).toBe('a.pdf');
      expect(document?.sha256).toBeNull();
    });
  });

  describe('accounts and companies', () => {
    it('creates each account once, with the currencies it was seen holding', async () => {
      const { world } = await run([
        row(SALE),
        row({ ...SALE, txn: 'Transaction005' }),
      ]);

      const exchange = await world.accounts.findByCode('coindcx');
      expect([...(exchange?.allowedCurrencies ?? [])].sort()).toEqual([
        'INR',
        'USDT',
      ]);
    });

    it('widens an allow-list when a new currency appears on an account', async () => {
      const { world } = await run([
        row(SALE),
        row({
          txn: 'Transaction009',
          kind: 'withdrawal',
          from: ['rise', 'Rise', 'processor'],
          to: CDX,
          fromAmount: '100.00',
          fromCurrency: 'USD',
          toAmount: '100.00',
          toCurrency: 'USDT',
          rate: '1.00000000',
        }),
      ]);

      const exchange = await world.accounts.findByCode('coindcx');
      expect(exchange?.allows('USDT')).toBe(true);
      expect(exchange?.allows('INR')).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('a second run creates nothing', async () => {
      const { useCase, result } = await run([
        row({ ...SALE, tds: '44.68', documents: 'a.pdf' }),
      ]);
      const second = await useCase.execute({ location: 'legacy.csv' });

      expect(result.transactions.created).toBe(1);
      expect(second.transactions).toEqual({ created: 0, reused: 1 });
      expect(second.documents).toEqual({ created: 0, reused: 1 });
      expect(second.payouts).toEqual({ created: 0, reused: 1 });
    });

    it('does not duplicate fees or links', async () => {
      const { world, useCase } = await run([
        row({ ...SALE, tds: '44.68', documents: 'a.pdf' }),
      ]);
      await useCase.execute({ location: 'legacy.csv' });

      const sale = await world.transactions.findByCode('Transaction003');
      if (sale === null) throw new Error('missing');

      expect(
        await world.transactions.listFeesByTransaction(sale.id),
      ).toHaveLength(1);
      expect(world.documents.linkCount()).toBe(1);
    });
  });

  describe('rejections', () => {
    it('names the row and column when a date is wrong', async () => {
      await expect(run([row({ ...SALE, date: '2025-03-16' })])).rejects.toThrow(
        /Row 2, column 'Date'/,
      );
    });

    it('rejects a currency the registry does not know', async () => {
      await expect(run([row({ ...SALE, toCurrency: 'GBP' })])).rejects.toThrow(
        /Unknown currency/,
      );
    });

    it('rejects a column the sheet does not have', async () => {
      const world = TestWorld.withCounterparties();
      const useCase = new ImportLegacyCsv({
        csv: FakeCsvReader.of(['TxnId'], [['Transaction001']]),
        companies: world.companies,
        accounts: world.accounts,
        payouts: world.payouts,
        transactions: world.transactions,
        documents: world.documents,
        currencies: world.currencies,
      });

      await expect(useCase.execute({ location: 'legacy.csv' })).rejects.toThrow(
        LegacyCsvError,
      );
    });
  });
});
