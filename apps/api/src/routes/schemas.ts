import {
  ACCOUNT_TYPES,
  DOCUMENT_TYPES,
  TRANSACTION_KINDS,
  type TransactionKind,
} from '@payout/core';
import { z } from 'zod';

/**
 * Request shapes, in one file, as zod schemas.
 *
 * Two rules run through all of them:
 *
 * **Money is a string.** N1 says money is never a float, and that has to hold
 * at the edge as well as in the domain — `z.number()` on an amount would
 * parse `4417.32` into a float64 before `Money` ever saw it, and the rounding
 * would already have happened. So: a decimal *string*, validated by shape,
 * handed to `Money.fromDecimalString` intact.
 *
 * **Rates are strings too**, for the same reason, and become the 1e8-scaled
 * bigint the schema stores.
 */

/** `-?123` or `-?123.45`. No exponent: `1.43908E+19` is how §9 defect 3 began. */
const DECIMAL = /^-?\d{1,18}(\.\d{1,18})?$/;

/** A money amount as written by a person: a decimal string, never a number. */
export const decimalString = z
  .string()
  .trim()
  .regex(DECIMAL, 'expected a decimal number, for example 4417.32');

/** A positive money amount. Zero is rejected here, not deep in the domain. */
export const positiveDecimalString = decimalString.refine(
  (value) => Number.parseFloat(value) > 0,
  'expected an amount greater than zero',
);

/**
 * §7: dates match `YYYY-MM-DD`. The database enforces the shape; this also
 * checks the date exists.
 *
 * The round-trip is not decoration. `Date.parse('2025-02-30')` does not fail
 * — it rolls over to 2 March and hands back a perfectly good timestamp, so a
 * validator built on it accepts the 30th of February and silently files the
 * transaction on the wrong day. Building the date and reading the fields back
 * is the only way to catch that.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return false;
    }

    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'not a real date');

/** ISO 4217-ish: three to eight upper-case letters, so USDT fits. */
export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3,8}$/, 'expected a currency code such as INR, USD or USDT');

/**
 * A rate as a decimal string, converted to the 1e8-scaled integer §6 stores.
 *
 * Done here rather than in the use case because the use case takes a bigint
 * and should keep taking one: the scaling is a property of the wire format,
 * not of the domain.
 */
export const scaledRate = decimalString.transform((value, context) => {
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > 8) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'a rate carries at most 8 decimal places',
    });
    return z.NEVER;
  }
  return BigInt(`${whole}${fraction.padEnd(8, '0')}`);
});

/** A path parameter that must be a positive integer row id. */
export const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Built from the domain's own arrays, not copied from them.
 *
 * A hand-written list here is the same set as the domain right up until
 * somebody adds a kind, at which point the API silently rejects it with a
 * validation error that looks like the caller's fault.
 */
export const transactionKind = z.enum(TRANSACTION_KINDS);

export const documentType = z.enum(DOCUMENT_TYPES);

// ---------- Companies ----------

export const createCompanyBody = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(256),
    notes: z.string().max(4096).nullish(),
  })
  .strict();

// ---------- Accounts ----------

/**
 * Built from the domain's own list, like every other union here.
 *
 * `accounts.type` has a CHECK constraint naming the same five, so a
 * hand-written list would be the same set right up until somebody adds a
 * sixth — at which point the API would reject it with a message that looks
 * like the caller's fault.
 */
export const accountType = z.enum(ACCOUNT_TYPES);

export const createAccountBody = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(256),
    type: accountType,
    companyId: z.number().int().positive().nullish(),
    /**
     * Optional, and an empty array is not the same as omitting it — both mean
     * "holds anything" to the domain, which is what `Account.allows` does with
     * an empty allow-list, so there is nothing to distinguish.
     */
    allowedCurrencies: z.array(currencyCode).max(32).optional(),
  })
  .strict();

export const listAccountsQuery = z
  .object({ type: accountType.optional() })
  .strict();

// ---------- Payouts ----------

export const createPayoutBody = z
  .object({
    code: z.string().trim().min(1).max(64),
    companyId: z.number().int().positive(),
    payoutDate: isoDate.optional(),
    grossAmount: positiveDecimalString,
    currencyCode,
    charges: decimalString.optional(),
    reference: z.string().max(256).nullish(),
    notes: z.string().max(4096).nullish(),
  })
  .strict();

export const listPayoutsQuery = z
  .object({
    companyId: z.coerce.number().int().positive().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'from and to must be given together',
    path: ['from'],
  });

// ---------- Transactions ----------

/**
 * Every kind that is not a sale.
 *
 * `satisfies` catches a member that is not a real kind. The type below
 * catches the opposite and more dangerous mistake — a new kind added to the
 * domain and forgotten here, which would make the API reject it as a bad
 * request. Adding one to `TRANSACTION_KINDS` breaks this line until it is
 * either listed here or given its own branch, as `sale` has.
 */
const MOVEMENT_KINDS = [
  'payout_credit',
  'withdrawal',
  'transfer',
  'deposit',
] as const satisfies readonly TransactionKind[];

type UnhandledKind = Exclude<
  TransactionKind,
  (typeof MOVEMENT_KINDS)[number] | 'sale'
>;
const _everyKindIsHandled: UnhandledKind[] = [];
void _everyKindIsHandled;

/**
 * Two shapes, discriminated on `kind`.
 *
 * A sale is not a transfer with extra fields: it has no `toAmount` (gross
 * proceeds are computed from the amount and the rate, §13), it must have a
 * rate, and it carries TDS. Modelling it as one loose schema with everything
 * optional would push the decision into the route as an `if`, which is the
 * business logic routes are not allowed to hold.
 */
const movementBody = z
  .object({
    kind: z.enum(MOVEMENT_KINDS),
    code: z.string().trim().min(1).max(64),
    payoutId: z.number().int().positive(),
    parentId: z.number().int().positive().nullish(),
    txnDate: isoDate,
    fromAccountId: z.number().int().positive(),
    toAccountId: z.number().int().positive(),
    fromAmount: positiveDecimalString,
    fromCurrencyCode: currencyCode,
    toAmount: positiveDecimalString,
    toCurrencyCode: currencyCode,
    rate: scaledRate.nullish(),
    notes: z.string().max(4096).nullish(),
  })
  .strict();

const saleBody = z
  .object({
    kind: z.literal('sale'),
    code: z.string().trim().min(1).max(64),
    payoutId: z.number().int().positive(),
    parentId: z.number().int().positive().nullish(),
    txnDate: isoDate,
    fromAccountId: z.number().int().positive(),
    toAccountId: z.number().int().positive(),
    fromAmount: positiveDecimalString,
    fromCurrencyCode: currencyCode,
    /** Required, not optional: a sale without a rate has no gross proceeds. */
    rate: scaledRate,
    settlementCurrencyCode: currencyCode,
    /** Statutory, from the statement — never computed (§8, §13). */
    tds: decimalString.nullish(),
    notes: z.string().max(4096).nullish(),
  })
  .strict();

export const createTransactionBody = z.discriminatedUnion('kind', [
  movementBody,
  saleBody,
]);

export const listTransactionsQuery = z
  .object({ payoutId: z.coerce.number().int().positive().optional() })
  .strict();

// ---------- Documents ----------

export const searchDocumentsQuery = z
  .object({ q: z.string().min(1, 'a search needs something to search for') })
  .strict();

/** The non-file fields of the multipart upload. */
export const attachDocumentFields = z
  .object({
    role: z.string().max(64).nullish(),
    docType: documentType.nullish(),
    docDate: isoDate.nullish(),
  })
  .strict();

// ---------- Reports and checks ----------

export const dataQualityQuery = z
  .object({
    payoutId: z.coerce.number().int().positive().optional(),
    tolerancePct: z.coerce.number().min(0).max(100).optional(),
  })
  .strict();

export const financialYearQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    currencyCode: currencyCode.optional(),
  })
  .strict()
  .refine((query) => query.from <= query.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const settlementQuery = z
  .object({ currencyCode: currencyCode.optional() })
  .strict();

export const balancesQuery = z
  .object({ payoutId: z.coerce.number().int().positive().optional() })
  .strict();
