import { describe, expect, it } from 'vitest';

import type { Account } from './account';
import { INR, USD, USDT } from './currency';
import { PayoutNotFoundError } from './errors';
import type { AccountId } from './ids';
import { Money } from './money';
import { Payout } from './payout';
import {
  ACCOUNTS,
  FEES,
  PAYOUT,
  SALES,
  TRANSACTIONS,
} from './reference-payout.fixture';
import { Transaction } from './transaction';
import { TransactionFee } from './transaction-fee';

describe('Payout', () => {
  describe('construction', () => {
    it('carries the award and the platform charge', () => {
      expect(PAYOUT.code).toBe('TradeifyPayout001');
      expect(PAYOUT.gross.toDecimalString()).toBe('1008.01');
      expect(PAYOUT.charges.toDecimalString()).toBe('100.79');
      expect(PAYOUT.gross.currency.code).toBe('USD');
    });

    it('renames its reference into a new instance', () => {
      const updated = PAYOUT.withReference('OTHER-REF');

      expect(updated.reference).toBe('OTHER-REF');
      expect(PAYOUT.reference).toBe('FTDFYSLX50676373980');
    });
  });

  describe('the TradeifyPayout001 tree — CLAUDE.md §10', () => {
    it('nets ₹84,642.93', () => {
      const net = PAYOUT.netCredited(TRANSACTIONS, FEES, INR);

      expect(net.toDecimalString()).toBe('84642.93');
      expect(net.minor).toBe(8464293n);
    });

    it('reaches ₹86,027.56 of gross proceeds across the four sale legs', () => {
      const proceeds = PAYOUT.grossProceeds(TRANSACTIONS, INR);

      expect(proceeds.toDecimalString()).toBe('86027.56');
    });

    it('totals ₹1,384.63 of INR fees', () => {
      const fees = PAYOUT.totalFees(TRANSACTIONS, FEES, INR);

      expect(fees.toDecimalString()).toBe('1384.63');
    });

    it('breaks those fees down to the §10 figures', () => {
      const byType = PAYOUT.feesByType(TRANSACTIONS, FEES, INR);

      expect(byType.get('tds')?.toDecimalString()).toBe('868.88');
      expect(byType.get('exchange_fee')?.toDecimalString()).toBe('437.09');
      expect(byType.get('gst')?.toDecimalString()).toBe('78.66');
    });

    it('keeps the $16.31 of network fees out of the INR settlement', () => {
      const inUsd = PAYOUT.totalFees(TRANSACTIONS, FEES, USD);

      expect(inUsd.toDecimalString()).toBe('16.31');
    });

    it('agrees that proceeds minus fees is the net', () => {
      const proceeds = PAYOUT.grossProceeds(TRANSACTIONS, INR);
      const fees = PAYOUT.totalFees(TRANSACTIONS, FEES, INR);

      expect(
        proceeds
          .subtract(fees)
          .equals(PAYOUT.netCredited(TRANSACTIONS, FEES, INR)),
      ).toBe(true);
    });

    it('derives each sale leg from its own from-amount and rate', () => {
      const perLeg = SALES.map((sale) =>
        sale.grossProceeds().toDecimalString(),
      );

      expect(perLeg).toEqual(['4444.28', '4421.25', '4278.45', '72883.58']);
    });

    it('counts only sale legs denominated in the settlement currency', () => {
      // Asking for the USD view of a rupee settlement is not an error and
      // not a currency mismatch — there are simply no USD proceeds.
      expect(PAYOUT.grossProceeds(TRANSACTIONS, USD).isZero()).toBe(true);
    });

    it('settles, because a sale leg reached the bank', () => {
      expect(PAYOUT.status(TRANSACTIONS, ACCOUNTS)).toBe('settled');
    });
  });

  describe('netCredited', () => {
    it('is zero when nothing has happened yet', () => {
      const net = PAYOUT.netCredited([], [], INR);

      expect(net.isZero()).toBe(true);
      expect(net.currency.code).toBe('INR');
    });

    it('ignores legs belonging to another payout', () => {
      const foreign = Transaction.record({
        id: 99,
        code: 'Transaction099',
        payoutId: 2,
        parentId: null,
        txnDate: '2025-04-01',
        kind: 'sale',
        fromAccountId: 4,
        toAccountId: 5,
        fromAmount: Money.fromDecimalString('100', USDT),
        toAmount: Money.fromDecimalString('9825.00', INR),
        rate: null,
      });

      const net = PAYOUT.netCredited([...TRANSACTIONS, foreign], FEES, INR);

      expect(net.toDecimalString()).toBe('84642.93');
    });

    it('ignores fees attached to another payout’s legs', () => {
      const foreignFee = TransactionFee.record({
        id: 99,
        transactionId: 99,
        feeType: 'tds',
        amount: Money.fromDecimalString('500.00', INR),
      });

      const net = PAYOUT.netCredited(TRANSACTIONS, [...FEES, foreignFee], INR);

      expect(net.toDecimalString()).toBe('84642.93');
    });

    it('counts only sale legs as proceeds', () => {
      const withoutSales = TRANSACTIONS.filter((leg) => !leg.isSale());

      // Drop the sales and both sides go: no proceeds, and no INR fees
      // either, because every one of them hung off a sale leg.
      expect(PAYOUT.grossProceeds(withoutSales, INR).isZero()).toBe(true);
      expect(PAYOUT.totalFees(withoutSales, FEES, INR).isZero()).toBe(true);
      expect(PAYOUT.netCredited(withoutSales, FEES, INR).isZero()).toBe(true);
    });

    it('subtracts an INR fee that rides a leg other than a sale', () => {
      // Fees are not a property of sales — a rupee fee on the withdrawal leg
      // reduces the net just the same.
      const onWithdrawal = TransactionFee.record({
        id: 98,
        transactionId: 2,
        feeType: 'platform_charge',
        amount: Money.fromDecimalString('10.00', INR),
      });

      const net = PAYOUT.netCredited(
        TRANSACTIONS,
        [...FEES, onWithdrawal],
        INR,
      );

      expect(net.toDecimalString()).toBe('84632.93');
    });
  });

  describe('status is derived, never stored', () => {
    it('is open while no sale leg has reached a bank', () => {
      const beforeSales = TRANSACTIONS.filter((leg) => !leg.isSale());

      expect(PAYOUT.status(beforeSales, ACCOUNTS)).toBe('open');
    });

    it('is open when the only sale landed somewhere that is not a bank', () => {
      const toWallet = Transaction.record({
        id: 50,
        code: 'Transaction050',
        payoutId: 1,
        parentId: null,
        txnDate: '2025-03-20',
        kind: 'sale',
        fromAccountId: 4,
        toAccountId: 3,
        fromAmount: Money.fromDecimalString('10', USDT),
        toAmount: Money.fromDecimalString('10', USDT),
        rate: null,
      });

      expect(PAYOUT.status([toWallet], ACCOUNTS)).toBe('open');
    });

    it('is open when an account in the tree is unknown to the directory', () => {
      const empty = new Map<AccountId, Account>();

      expect(PAYOUT.status(TRANSACTIONS, empty)).toBe('open');
    });

    it('flips to settled purely from the legs it is handed', () => {
      expect(PAYOUT.status([], ACCOUNTS)).toBe('open');
      expect(PAYOUT.status(TRANSACTIONS, ACCOUNTS)).toBe('settled');
    });

    it('is not reachable as a property, only as a computation', () => {
      expect((PAYOUT as unknown as Record<string, unknown>)['_status']).toBe(
        undefined,
      );
      expect(typeof PAYOUT.status).toBe('function');
    });
  });

  describe('require', () => {
    it('finds a payout by id', () => {
      expect(Payout.require([PAYOUT], 1)).toBe(PAYOUT);
    });

    it('throws PayoutNotFoundError when it is absent', () => {
      expect(() => Payout.require([PAYOUT], 7)).toThrow(PayoutNotFoundError);
    });

    it('carries the id it looked for', () => {
      try {
        Payout.require([], 7);
        expect.unreachable('require should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PayoutNotFoundError);
        expect((error as PayoutNotFoundError).payoutId).toBe(7);
      }
    });
  });
});
