import { describe, expect, it } from 'vitest';

import { INR, USD, USDT } from './currency';
import { AmbiguousFeeScheduleError, UnresolvableFeeBasisError } from './errors';
import { compareToActual, expectedFees, type ExpectedFee } from './fee-engine';
import { FeeSchedule, type FeeScheduleProps } from './fee-schedule';
import type { FeeType } from './transaction-fee';
import { Money } from './money';
import { Transaction } from './transaction';
import { TransactionFee } from './transaction-fee';

// ---------- fixtures ----------

/**
 * The sale from CLAUDE.md §6 and §9: 45.2292 USDT at ₹97.6652, giving
 * ₹4,417.32 of gross proceeds. CoinDCX (account 4) to the bank (account 5).
 */
const SALE = Transaction.record({
  id: 3,
  code: 'Transaction003',
  payoutId: 1,
  parentId: null,
  txnDate: '2025-03-16',
  kind: 'sale',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: Money.fromDecimalString('45.2292', USDT),
  toAmount: Money.fromDecimalString('4417.32', INR),
  rate: 9766520000n,
});

/** A Rise withdrawal, account 2 to account 3. */
const WITHDRAWAL = Transaction.record({
  id: 2,
  code: 'Transaction002',
  payoutId: 1,
  parentId: null,
  txnDate: '2025-03-11',
  kind: 'withdrawal',
  fromAccountId: 2,
  toAccountId: 3,
  fromAmount: Money.fromDecimalString('226.81', USD),
  toAmount: Money.fromDecimalString('222.78', USDT),
  rate: 100000000n,
});

const schedule = (overrides: Partial<FeeScheduleProps>): FeeSchedule =>
  FeeSchedule.create({
    id: 1,
    accountId: 4,
    feeType: 'exchange_fee',
    basis: 'to_amount',
    rateBps: 50,
    flatAmount: null,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    ...overrides,
  });

/** CoinDCX: 0.50% of proceeds. */
const COINDCX_EXCHANGE_FEE = schedule({ id: 1 });

/** CoinDCX: GST at 18% of that exchange fee. */
const COINDCX_GST = schedule({
  id: 2,
  feeType: 'gst',
  basis: 'exchange_fee',
  rateBps: 1800,
});

/** Rise: a flat $4.00 per withdrawal, whatever the size. */
const RISE_NETWORK_FEE = schedule({
  id: 3,
  accountId: 2,
  feeType: 'network_fee',
  basis: 'flat',
  rateBps: null,
  flatAmount: Money.fromDecimalString('4.00', USD),
});

const find = (fees: readonly ExpectedFee[], type: FeeType): ExpectedFee => {
  const found = fees.find((fee) => fee.feeType === type);
  if (found === undefined) {
    throw new Error(
      `no expected '${type}' among [${fees.map((f) => f.feeType).join(', ')}]`,
    );
  }
  return found;
};

// ---------- expectedFees ----------

describe('expectedFees', () => {
  it('computes the CoinDCX exchange fee at 50 bps of proceeds', () => {
    // 0.50% of ₹4,417.32 is ₹22.0866, rounding to ₹22.09.
    const fees = expectedFees(SALE, [COINDCX_EXCHANGE_FEE]);

    expect(fees).toHaveLength(1);
    expect(find(fees, 'exchange_fee').amount.toDecimalString()).toBe('22.09');
    expect(find(fees, 'exchange_fee').amount.currency.code).toBe('INR');
    expect(find(fees, 'exchange_fee').scheduleId).toBe(1);
  });

  it('computes GST at 1800 bps of the exchange fee, not of the proceeds', () => {
    // 18% of ₹22.09 is ₹3.9762 -> ₹3.98.
    // 18% of the ₹4,417.32 proceeds would be ₹795.12 — a different number
    // entirely, which is the whole point of the 'exchange_fee' basis.
    const fees = expectedFees(SALE, [COINDCX_EXCHANGE_FEE, COINDCX_GST]);

    expect(fees).toHaveLength(2);
    expect(find(fees, 'gst').amount.toDecimalString()).toBe('3.98');
    expect(find(fees, 'gst').amount.toDecimalString()).not.toBe('795.12');
  });

  it('resolves the dependency regardless of the order it is handed', () => {
    // GST first. It cannot be computed until the exchange fee exists, so the
    // engine must order by dependency and not by position.
    const reversed = expectedFees(SALE, [COINDCX_GST, COINDCX_EXCHANGE_FEE]);

    expect(find(reversed, 'gst').amount.toDecimalString()).toBe('3.98');
    expect(find(reversed, 'exchange_fee').amount.toDecimalString()).toBe(
      '22.09',
    );
  });

  it('returns a derived fee after the fee it derives from', () => {
    const fees = expectedFees(SALE, [COINDCX_GST, COINDCX_EXCHANGE_FEE]);
    const types = fees.map((fee) => fee.feeType);

    expect(types.indexOf('exchange_fee')).toBeLessThan(types.indexOf('gst'));
  });

  it('throws when GST has no exchange fee to derive from', () => {
    expect(() => expectedFees(SALE, [COINDCX_GST])).toThrow(
      UnresolvableFeeBasisError,
    );
  });

  it('throws when the exchange fee it needs has expired', () => {
    const expired = schedule({ id: 1, effectiveTo: '2025-01-31' });

    expect(() => expectedFees(SALE, [expired, COINDCX_GST])).toThrow(
      UnresolvableFeeBasisError,
    );
  });

  it('computes the Rise network fee as a flat amount in its own currency', () => {
    const fees = expectedFees(WITHDRAWAL, [RISE_NETWORK_FEE]);

    expect(fees).toHaveLength(1);
    expect(find(fees, 'network_fee').amount.toDecimalString()).toBe('4.00');
    expect(find(fees, 'network_fee').amount.currency.code).toBe('USD');
    expect(find(fees, 'network_fee').basis).toBe('flat');
  });

  it('charges the same flat fee whatever the withdrawal is worth', () => {
    const tiny = Transaction.record({
      id: 20,
      code: 'Transaction020',
      payoutId: 1,
      parentId: null,
      txnDate: '2025-03-11',
      kind: 'withdrawal',
      fromAccountId: 2,
      toAccountId: 3,
      fromAmount: Money.fromDecimalString('10.00', USD),
      toAmount: Money.fromDecimalString('6.00', USDT),
      rate: 100000000n,
    });

    // §8's complaint, in one assertion: $4 on $10 is 40%, and on $226.81
    // it is 1.8%.
    expect(
      find(
        expectedFees(tiny, [RISE_NETWORK_FEE]),
        'network_fee',
      ).amount.toDecimalString(),
    ).toBe('4.00');
  });

  describe('effective dates', () => {
    it('ignores a schedule that expired before the transaction', () => {
      const expired = schedule({ effectiveTo: '2025-01-31' });

      expect(expectedFees(SALE, [expired])).toEqual([]);
    });

    it('ignores a schedule that had not started yet', () => {
      const future = schedule({ effectiveFrom: '2025-06-01' });

      expect(expectedFees(SALE, [future])).toEqual([]);
    });

    it('applies a schedule that ends exactly on the transaction date', () => {
      const endsToday = schedule({ effectiveTo: '2025-03-16' });

      expect(expectedFees(SALE, [endsToday])).toHaveLength(1);
    });

    it('applies a schedule that starts exactly on the transaction date', () => {
      const startsToday = schedule({ effectiveFrom: '2025-03-16' });

      expect(expectedFees(SALE, [startsToday])).toHaveLength(1);
    });

    it('picks the schedule in force when an old one has been superseded', () => {
      const old = schedule({ id: 1, rateBps: 25, effectiveTo: '2025-01-31' });
      const current = schedule({ id: 4, effectiveFrom: '2025-02-01' });

      const fees = expectedFees(SALE, [old, current]);

      expect(fees).toHaveLength(1);
      expect(find(fees, 'exchange_fee').scheduleId).toBe(4);
      expect(find(fees, 'exchange_fee').amount.toDecimalString()).toBe('22.09');
    });
  });

  describe('nothing to say', () => {
    it('returns no expected fees for an account with no schedule at all', () => {
      expect(expectedFees(SALE, [])).toEqual([]);
    });

    it('returns no expected fees rather than throwing', () => {
      expect(() => expectedFees(SALE, [])).not.toThrow();
    });

    it('ignores schedules belonging to a different account', () => {
      // The Rise schedule is account 2; this sale leaves account 4.
      expect(expectedFees(SALE, [RISE_NETWORK_FEE])).toEqual([]);
    });

    it('reads the schedule from the paying side — the from-account', () => {
      // Account 5 is the destination of the sale, not its source.
      const onDestination = schedule({ accountId: 5 });

      expect(expectedFees(SALE, [onDestination])).toEqual([]);
    });
  });

  describe('basis', () => {
    it('takes from_amount when the schedule says so', () => {
      // §11's open question: if CoinDCX charges on order value rather than
      // proceeds, this is the only change needed — 0.5% of 45.2292 USDT.
      const onOrderValue = schedule({ basis: 'from_amount' });
      const fees = expectedFees(SALE, [onOrderValue]);

      expect(find(fees, 'exchange_fee').amount.toDecimalString()).toBe(
        '0.22614600',
      );
      expect(find(fees, 'exchange_fee').amount.currency.code).toBe('USDT');
    });

    it('honours an explicit rounding mode', () => {
      // ₹22.0866 truncates to ₹22.08 and rounds up to ₹22.09.
      const down = expectedFees(SALE, [COINDCX_EXCHANGE_FEE], {
        rounding: 'toward-zero',
      });

      expect(find(down, 'exchange_fee').amount.toDecimalString()).toBe('22.08');
    });

    it('refuses two overlapping schedules for the same fee type', () => {
      const duplicate = schedule({ id: 9, rateBps: 75 });

      expect(() =>
        expectedFees(SALE, [COINDCX_EXCHANGE_FEE, duplicate]),
      ).toThrow(AmbiguousFeeScheduleError);
    });
  });
});

// ---------- compareToActual ----------

const actualFee = (type: FeeType, amount: string, currency = INR) =>
  TransactionFee.record({
    id: 1,
    transactionId: 3,
    feeType: type,
    amount: Money.fromDecimalString(amount, currency),
  });

describe('compareToActual', () => {
  const expected = () => expectedFees(SALE, [COINDCX_EXCHANGE_FEE]);

  describe('CLAUDE.md §9 defect 2 — the swapped exchange fee and GST', () => {
    it('flags ₹370.64 recorded against ₹4,417.32 of proceeds', () => {
      // As written the sheet implies 8.39%, not 0.5%. This is the row the
      // importer corrects, and the row the app has to notice if it does not.
      const discrepancies = compareToActual(
        expected(),
        [actualFee('exchange_fee', '370.64')],
        2,
      );

      expect(discrepancies).toHaveLength(1);

      const [flagged] = discrepancies;
      expect(flagged?.feeType).toBe('exchange_fee');
      expect(flagged?.reason).toBe('amount_off_schedule');
      expect(flagged?.expected.toDecimalString()).toBe('22.09');
      expect(flagged?.actual?.toDecimalString()).toBe('370.64');
      expect(flagged?.difference?.toDecimalString()).toBe('348.55');
    });

    it('accepts the corrected ₹22.44 at the same 2% tolerance', () => {
      // Unswapped, §9 says both legs work out at 0.508%. That is 35 paise
      // above the 0.5% expectation, inside a 44-paise tolerance.
      const discrepancies = compareToActual(
        expected(),
        [actualFee('exchange_fee', '22.44')],
        2,
      );

      expect(discrepancies).toEqual([]);
    });

    it('would flag the corrected value under a tighter tolerance', () => {
      expect(
        compareToActual(expected(), [actualFee('exchange_fee', '22.44')], 1),
      ).toHaveLength(1);
    });
  });

  it('says nothing when the actual matches the schedule exactly', () => {
    expect(
      compareToActual(expected(), [actualFee('exchange_fee', '22.09')], 2),
    ).toEqual([]);
  });

  it('flags a fee that should be there and is not', () => {
    const discrepancies = compareToActual(expected(), [], 2);

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]?.reason).toBe('missing');
    expect(discrepancies[0]?.actual).toBeNull();
    expect(discrepancies[0]?.expected.toDecimalString()).toBe('22.09');
  });

  it('ignores recorded fees that no schedule predicts', () => {
    // TDS is a statutory amount taken from the statement, not computed from
    // a schedule. Flagging it would make the report useless.
    const discrepancies = compareToActual(
      expected(),
      [actualFee('exchange_fee', '22.09'), actualFee('tds', '868.88')],
      2,
    );

    expect(discrepancies).toEqual([]);
  });

  it('flags a fee recorded in the wrong currency instead of throwing', () => {
    const discrepancies = compareToActual(
      expected(),
      [actualFee('exchange_fee', '22.09', USD)],
      2,
    );

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]?.reason).toBe('currency_mismatch');
    expect(discrepancies[0]?.difference).toBeNull();
  });

  describe('tolerance', () => {
    it('accepts a difference exactly on the tolerance', () => {
      // 2% of ₹22.09 is 44.18 paise, which rounds to a 44-paise allowance.
      expect(
        compareToActual(expected(), [actualFee('exchange_fee', '22.53')], 2),
      ).toEqual([]);
    });

    it('flags a difference one paisa beyond it', () => {
      expect(
        compareToActual(expected(), [actualFee('exchange_fee', '22.54')], 2),
      ).toHaveLength(1);
    });

    it('flags in both directions', () => {
      const under = compareToActual(
        expected(),
        [actualFee('exchange_fee', '1.00')],
        2,
      );

      expect(under).toHaveLength(1);
      expect(under[0]?.difference?.toDecimalString()).toBe('-21.09');
    });

    it('flags any non-zero actual when the expected fee is zero', () => {
      const free = schedule({ rateBps: 0 });
      const discrepancies = compareToActual(
        expectedFees(SALE, [free]),
        [actualFee('exchange_fee', '22.09')],
        2,
      );

      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0]?.expected.isZero()).toBe(true);
    });

    it('reports nothing when there is nothing expected', () => {
      expect(compareToActual([], [actualFee('tds', '868.88')], 2)).toEqual([]);
    });
  });

  it('carries the tolerance it applied, in basis points', () => {
    const discrepancies = compareToActual(
      expected(),
      [actualFee('exchange_fee', '370.64')],
      2,
    );

    expect(discrepancies[0]?.toleranceBps).toBe(200);
  });
});
