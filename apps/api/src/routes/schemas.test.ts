import { DOCUMENT_TYPES, TRANSACTION_KINDS } from '@payout/core';
import { describe, expect, it } from 'vitest';

import {
  createPayoutBody,
  createTransactionBody,
  currencyCode,
  decimalString,
  documentType,
  financialYearQuery,
  idParam,
  isoDate,
  positiveDecimalString,
  scaledRate,
  transactionKind,
} from './schemas';

describe('decimalString', () => {
  it.each(['0', '0.00', '4417.32', '-16.31', '875.48690000', '1008.01'])(
    'accepts %s',
    (value) => {
      expect(decimalString.parse(value)).toBe(value);
    },
  );

  it('rejects a JSON number outright', () => {
    // N1: a float64 has already rounded by the time it reaches this parser.
    expect(decimalString.safeParse(4417.32).success).toBe(false);
  });

  it('rejects exponent notation, which is how §9 defect 3 happened', () => {
    expect(decimalString.safeParse('1.43908E+19').success).toBe(false);
    expect(decimalString.safeParse('1e5').success).toBe(false);
  });

  it.each(['', 'abc', '12.', '.5', '1,008.01', '1 008', '0x10', 'NaN'])(
    'rejects %s',
    (value) => {
      expect(decimalString.safeParse(value).success).toBe(false);
    },
  );

  it('trims surrounding whitespace rather than rejecting it', () => {
    expect(decimalString.parse('  4417.32  ')).toBe('4417.32');
  });

  it('keeps trailing zeros, which carry the scale', () => {
    // 875.48690000 is eight decimal places of USDT, not 875.4869.
    expect(decimalString.parse('875.48690000')).toBe('875.48690000');
  });

  describe('positiveDecimalString', () => {
    it('rejects zero and negatives', () => {
      expect(positiveDecimalString.safeParse('0').success).toBe(false);
      expect(positiveDecimalString.safeParse('0.00').success).toBe(false);
      expect(positiveDecimalString.safeParse('-1.00').success).toBe(false);
    });

    it('accepts the smallest positive amount', () => {
      expect(positiveDecimalString.parse('0.01')).toBe('0.01');
    });
  });
});

describe('scaledRate', () => {
  it('scales by 1e8, as §6 stores it', () => {
    expect(scaledRate.parse('97.6652')).toBe(9766520000n);
  });

  it('handles a whole number', () => {
    expect(scaledRate.parse('98')).toBe(9800000000n);
  });

  it('handles the full eight decimal places', () => {
    expect(scaledRate.parse('98.44483312')).toBe(9844483312n);
  });

  it('returns a bigint, so no rate passes through a float', () => {
    expect(typeof scaledRate.parse('97.6652')).toBe('bigint');
  });

  it('rejects a ninth decimal place rather than silently dropping it', () => {
    // Truncating would change the rate and the proceeds computed from it.
    expect(scaledRate.safeParse('97.665212345').success).toBe(false);
  });
});

describe('isoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isoDate.parse('2025-03-16')).toBe('2025-03-16');
  });

  it.each(['16-03-2025', '2025/03/16', '2025-3-16', 'March 16 2025'])(
    'rejects %s',
    (value) => {
      expect(isoDate.safeParse(value).success).toBe(false);
    },
  );

  it.each(['2025-02-30', '2025-13-01', '2025-00-10', '2025-04-31'])(
    'rejects %s, which does not exist',
    (value) => {
      // `Date.parse` accepts all of these by rolling them over, which would
      // file a transaction on a day that is not the one written down.
      expect(isoDate.safeParse(value).success).toBe(false);
    },
  );

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
    expect(isoDate.safeParse('2025-02-29').success).toBe(false);
  });
});

describe('currencyCode', () => {
  it.each(['INR', 'USD', 'USDT'])('accepts %s', (value) => {
    expect(currencyCode.parse(value)).toBe(value);
  });

  it('rejects lower case rather than silently upper-casing it', () => {
    expect(currencyCode.safeParse('inr').success).toBe(false);
  });

  it('rejects something too short or too long to be a code', () => {
    expect(currencyCode.safeParse('IN').success).toBe(false);
    expect(currencyCode.safeParse('VERYLONGCODE').success).toBe(false);
  });
});

describe('the enums come from the domain, not from a copy', () => {
  it('accepts every transaction kind the domain defines', () => {
    for (const kind of TRANSACTION_KINDS) {
      expect(transactionKind.parse(kind)).toBe(kind);
    }
  });

  it('accepts every document type the domain defines', () => {
    for (const type of DOCUMENT_TYPES) {
      expect(documentType.parse(type)).toBe(type);
    }
  });

  it('rejects a plausible type the domain does not have', () => {
    expect(documentType.safeParse('contract').success).toBe(false);
  });
});

describe('idParam', () => {
  it('coerces a path string to a number', () => {
    expect(idParam.parse({ id: '42' })).toEqual({ id: 42 });
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects %s', (id) => {
    expect(idParam.safeParse({ id }).success).toBe(false);
  });
});

describe('createPayoutBody', () => {
  const valid = {
    code: 'TradeifyPayout001',
    companyId: 1,
    // F24: a payout belongs to somebody, so the minimum body says who.
    traderId: 1,
    grossAmount: '1008.01',
    currencyCode: 'USD',
  };

  it('accepts the minimum', () => {
    expect(createPayoutBody.parse(valid)).toMatchObject(valid);
  });

  it('rejects an unknown field rather than dropping it', () => {
    expect(createPayoutBody.safeParse({ ...valid, id: 1 }).success).toBe(false);
  });

  it('rejects a companyId that is not a row id', () => {
    expect(createPayoutBody.safeParse({ ...valid, companyId: 0 }).success).toBe(
      false,
    );
  });
});

describe('createTransactionBody', () => {
  const movement = {
    kind: 'transfer',
    code: 'T1',
    payoutId: 1,
    txnDate: '2025-03-16',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: '222.44',
    fromCurrencyCode: 'USDT',
    toAmount: '222.44',
    toCurrencyCode: 'USDT',
  };

  const sale = {
    kind: 'sale',
    code: 'S1',
    payoutId: 1,
    txnDate: '2025-03-16',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: '45.2292',
    fromCurrencyCode: 'USDT',
    rate: '97.6652',
    settlementCurrencyCode: 'INR',
  };

  it('accepts a movement', () => {
    expect(createTransactionBody.parse(movement)).toMatchObject({
      kind: 'transfer',
    });
  });

  it('accepts a sale and scales its rate', () => {
    const parsed = createTransactionBody.parse(sale);

    expect(parsed).toMatchObject({ kind: 'sale', rate: 9766520000n });
  });

  it('requires a toAmount on a movement', () => {
    const { toAmount: _toAmount, ...without } = movement;

    expect(createTransactionBody.safeParse(without).success).toBe(false);
  });

  it('requires a rate on a sale', () => {
    const { rate: _rate, ...without } = sale;

    expect(createTransactionBody.safeParse(without).success).toBe(false);
  });

  it('refuses a toAmount on a sale, which it would only ignore', () => {
    // Gross proceeds come from the rate (§13). Accepting a to-amount and
    // overwriting it is how a caller ends up believing a number that is not
    // what was stored.
    expect(
      createTransactionBody.safeParse({ ...sale, toAmount: '4417.32' }).success,
    ).toBe(false);
  });

  it('refuses settlementCurrencyCode on a movement', () => {
    expect(
      createTransactionBody.safeParse({
        ...movement,
        settlementCurrencyCode: 'INR',
      }).success,
    ).toBe(false);
  });

  it('refuses a kind of "sale" reaching the movement branch', () => {
    // The discriminated union is what keeps the route free of an `if` that
    // weighs anything.
    const parsed = createTransactionBody.safeParse({
      ...movement,
      kind: 'sale',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(
      createTransactionBody.safeParse({ ...movement, kind: 'teleport' })
        .success,
    ).toBe(false);
  });
});

describe('financialYearQuery', () => {
  it('accepts an Indian financial year', () => {
    expect(
      financialYearQuery.parse({ from: '2024-04-01', to: '2025-03-31' }),
    ).toMatchObject({ from: '2024-04-01', to: '2025-03-31' });
  });

  it('rejects a range that runs backwards', () => {
    expect(
      financialYearQuery.safeParse({ from: '2025-03-31', to: '2024-04-01' })
        .success,
    ).toBe(false);
  });

  it('accepts a single-day range', () => {
    expect(
      financialYearQuery.safeParse({ from: '2025-03-10', to: '2025-03-10' })
        .success,
    ).toBe(true);
  });

  it('requires both ends', () => {
    expect(financialYearQuery.safeParse({ from: '2024-04-01' }).success).toBe(
      false,
    );
  });
});
