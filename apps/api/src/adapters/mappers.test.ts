import {
  currencies,
  CurrencyRegistry,
  SameAccountTransferError,
  UnknownCurrencyError,
} from '@payout/core';
import { describe, expect, it } from 'vitest';

import {
  RowMappingError,
  toAccount,
  toCompany,
  toDocument,
  toFeeSchedule,
  toPayout,
  toTransaction,
  toTransactionFee,
  type DocumentRow,
  type FeeScheduleRow,
  type PayoutRow,
  type TransactionRow,
} from './mappers';

/**
 * Mapping is tested without a database on purpose.
 *
 * A row is a plain object, so the interesting cases — a null where the entity
 * needs a value, a bigint that is too large to narrow, a flat fee schedule
 * with no currency — can be written down directly instead of being coaxed out
 * of SQLite. What the database actually returns is the adapters' problem, and
 * those tests use a real one.
 */
describe('row mappers', () => {
  describe('toCompany', () => {
    it('narrows the id and keeps the rest', () => {
      const company = toCompany({
        id: 1n,
        code: 'Tradeify001',
        name: 'Tradeify',
        notes: null,
      });

      expect(company.id).toBe(1);
      expect(company.code).toBe('Tradeify001');
      expect(company.notes).toBeNull();
    });

    it('refuses an id beyond the safe integer range', () => {
      expect(() =>
        toCompany({
          id: 9007199254740993n,
          code: 'X',
          name: 'X',
          notes: null,
        }),
      ).toThrow(RowMappingError);
    });
  });

  describe('toAccount', () => {
    const row = {
      id: 4n,
      code: 'coindcx',
      name: 'CoinDCX',
      type: 'exchange',
      company_id: null,
    };

    it('takes the allow-list from its own table, not from the row', () => {
      const account = toAccount(row, ['USDT', 'INR']);

      expect(account.type).toBe('exchange');
      expect(account.allowedCurrencies).toEqual(['USDT', 'INR']);
      expect(account.companyId).toBeNull();
    });

    it('treats an empty allow-list as multi-currency', () => {
      expect(toAccount(row, []).allows('GBP')).toBe(true);
    });
  });

  describe('toPayout', () => {
    const row: PayoutRow = {
      id: 1n,
      code: 'TradeifyPayout001',
      company_id: 1n,
      payout_date: '2025-03-10',
      reference: 'FTDFYSLX50676373980',
      gross_amount: 100801n,
      charges: 10079n,
      currency_code: 'USD',
      notes: null,
    };

    it('reads gross and charges in the row currency', () => {
      const payout = toPayout(row, currencies);

      expect(payout.gross.toDecimalString()).toBe('1008.01');
      expect(payout.charges.toDecimalString()).toBe('100.79');
      expect(payout.gross.currency.code).toBe('USD');
    });

    it('scales by the registry it is handed, not by a hard-coded 100', () => {
      // A registry that says USD has 3 decimal places must produce ₹1.00801.
      const odd = new CurrencyRegistry([{ code: 'USD', scale: 3 }]);

      expect(toPayout(row, odd).gross.toDecimalString()).toBe('100.801');
    });
  });

  describe('toTransaction', () => {
    const row: TransactionRow = {
      id: 3n,
      code: 'Transaction003',
      payout_id: 1n,
      parent_id: 7n,
      txn_date: '2025-03-16',
      kind: 'sale',
      from_account_id: 4n,
      to_account_id: 5n,
      from_amount: 4522920000n,
      from_currency: 'USDT',
      to_amount: 444428n,
      to_currency: 'INR',
      rate_applied: 9826120000n,
      notes: null,
    };

    it('carries both sides at their own scale', () => {
      const transaction = toTransaction(row, currencies);

      expect(transaction.fromAmount.toDecimalString()).toBe('45.22920000');
      expect(transaction.toAmount.toDecimalString()).toBe('4444.28');
      expect(transaction.rate).toBe(9826120000n);
      expect(transaction.parentId).toBe(7);
    });

    it('keeps the rate a bigint, never a float', () => {
      expect(typeof toTransaction(row, currencies).rate).toBe('bigint');
    });

    it('maps a null rate and a null parent', () => {
      const transaction = toTransaction(
        { ...row, rate_applied: null, parent_id: null },
        currencies,
      );

      expect(transaction.rate).toBeNull();
      expect(transaction.parentId).toBeNull();
    });

    it('re-runs the entity invariants on the way out of the database', () => {
      // The schema forbids this, so it should be unreachable — which is
      // exactly why the mapper should still refuse to build it.
      expect(() =>
        toTransaction({ ...row, from_account_id: 5n }, currencies),
      ).toThrow(SameAccountTransferError);
    });

    it('rejects a currency the registry does not know', () => {
      expect(() =>
        toTransaction({ ...row, to_currency: 'GBP' }, currencies),
      ).toThrow(UnknownCurrencyError);
    });
  });

  describe('toTransactionFee', () => {
    it('keeps the fee in its own currency, not the transaction’s', () => {
      const fee = toTransactionFee(
        {
          id: 1n,
          transaction_id: 2n,
          fee_type: 'network_fee',
          amount: 403n,
          currency_code: 'USD',
        },
        currencies,
      );

      expect(fee.feeType).toBe('network_fee');
      expect(fee.amount.toDecimalString()).toBe('4.03');
      expect(fee.amount.currency.code).toBe('USD');
    });
  });

  describe('toDocument', () => {
    const row: DocumentRow = {
      id: 1n,
      filename: 'coindcx-march.pdf',
      stored_path: 'ab/cd/abcd.pdf',
      mime_type: 'application/pdf',
      byte_size: 20480n,
      sha256: 'abcd',
      doc_type: 'statement',
      doc_date: '2025-03-31',
      extracted_text: null,
    };

    it('maps a complete row', () => {
      const document = toDocument(row);

      expect(document.filename).toBe('coindcx-march.pdf');
      expect(document.byteSize).toBe(20480);
      expect(document.docType).toBe('statement');
    });

    it('refuses a row with no content hash', () => {
      // The column is nullable in the schema; the entity requires it, because
      // a document without a hash can be neither deduplicated nor verified.
      expect(() => toDocument({ ...row, sha256: null })).toThrow(
        RowMappingError,
      );
    });

    it('allows the optional columns to be null', () => {
      const document = toDocument({
        ...row,
        mime_type: null,
        byte_size: null,
        doc_type: null,
        doc_date: null,
      });

      expect(document.byteSize).toBeNull();
      expect(document.docType).toBeNull();
    });
  });

  describe('toFeeSchedule', () => {
    const proportional: FeeScheduleRow = {
      id: 1n,
      account_id: 4n,
      fee_type: 'exchange_fee',
      basis: 'to_amount',
      rate_bps: 50n,
      flat_amount: null,
      currency_code: null,
      effective_from: '2024-01-01',
      effective_to: null,
    };

    it('maps a proportional schedule', () => {
      const schedule = toFeeSchedule(proportional, currencies);

      expect(schedule.rateBps).toBe(50);
      expect(schedule.flatAmount).toBeNull();
      expect(schedule.appliesOn('2025-03-16')).toBe(true);
    });

    it('maps a flat schedule into Money', () => {
      const schedule = toFeeSchedule(
        {
          ...proportional,
          id: 3n,
          account_id: 2n,
          fee_type: 'network_fee',
          basis: 'flat',
          rate_bps: null,
          flat_amount: 400n,
          currency_code: 'USD',
        },
        currencies,
      );

      expect(schedule.flatAmount?.toDecimalString()).toBe('4.00');
      expect(schedule.flatAmount?.currency.code).toBe('USD');
    });

    it('refuses a flat amount with no currency', () => {
      // The schema allows this pairing; it cannot be interpreted. Flagged
      // against fee_schedules in the first review and still unfixed.
      expect(() =>
        toFeeSchedule(
          {
            ...proportional,
            basis: 'flat',
            rate_bps: null,
            flat_amount: 400n,
            currency_code: null,
          },
          currencies,
        ),
      ).toThrow(RowMappingError);
    });
  });
});
