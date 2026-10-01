import {
  Account,
  ACCOUNT_TYPES,
  Company,
  Document,
  DOCUMENT_TYPES,
  FEE_BASES,
  FEE_TYPES,
  FeeSchedule,
  Money,
  Payout,
  Trader,
  Transaction,
  TRANSACTION_KINDS,
  TransactionFee,
  type CurrencyRegistry,
} from '@payout/core';
import { z } from 'zod';

import type { BulkLoad, DocumentAttachment, LedgerSnapshot } from './maintenance';

/**
 * The ledger as JSON, for F33's export file — and back again.
 *
 * **Not a copy of `app.db`.** A database file is the obvious thing to put in an
 * archive and the wrong one: it carries the schema of the version that wrote
 * it, the `users` row with its password hash, whatever the WAL happened to
 * hold, and nothing a person can read. This is the rows and only the rows, as
 * text, so an archive written today still restores after a migration, can be
 * opened in an editor by somebody checking what they have, and contains no
 * credential at all (§5a).
 *
 * **Not the API's JSON either.** `routes/serialize.ts` writes for a screen: it
 * rounds nothing but it adds `amount` as a decimal for display, and it is free
 * to change shape whenever a screen wants different fields. This shape has one
 * job — to come back in exactly as it went out — so it is versioned, it stores
 * money as minor units and a currency code, and it keeps every id.
 *
 * **Everything goes back through the domain.** `fromDump` builds `Money`,
 * `Transaction`, `TransactionFee` and the rest with their own constructors, so
 * an archive that has been edited — by a well-meaning owner or by anything
 * else — meets §7's invariants before a single row is written. The alternative,
 * inserting the JSON straight into the tables, would make this file a second
 * way into the database with none of the rules attached.
 */

/** Bumped when the shape changes in a way an older reader cannot handle. */
export const DUMP_VERSION = 1;

export const ARCHIVE_FORMAT = 'payout-tracker-export';

/** Minor units as a string: `bigint` has no place in JSON (§6). */
const minor = z.string().regex(/^-?\d{1,19}$/, 'expected an integer amount');

const money = z
  .object({ currency: z.string().min(1).max(10), minor })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string();
const nullableText = text.nullable();
const id = z.number().int().positive();

const named = z
  .object({ id, code: text, name: text, notes: nullableText })
  .strict();

export const ledgerDumpSchema = z
  .object({
    traders: z.array(named),
    companies: z.array(named),
    accounts: z.array(
      z
        .object({
          id,
          code: text,
          name: text,
          type: z.enum(ACCOUNT_TYPES),
          companyId: id.nullable(),
          allowedCurrencies: z.array(z.string()),
        })
        .strict(),
    ),
    payouts: z.array(
      z
        .object({
          id,
          code: text,
          companyId: id,
          traderId: id,
          payoutDate: isoDate,
          reference: nullableText,
          gross: money,
          charges: money,
          notes: nullableText,
        })
        .strict(),
    ),
    transactions: z.array(
      z
        .object({
          id,
          code: text,
          payoutId: id,
          parentId: id.nullable(),
          txnDate: isoDate,
          kind: z.enum(TRANSACTION_KINDS),
          fromAccountId: id,
          toAccountId: id,
          fromAmount: money,
          toAmount: money,
          /** Scaled by 1e8 (§6), as a string for the same reason as `minor`. */
          rate: minor.nullable(),
          fromExternalRef: nullableText,
          toExternalRef: nullableText,
          fromAddress: nullableText,
          toAddress: nullableText,
          explorerUrl: nullableText,
          notes: nullableText,
        })
        .strict(),
    ),
    fees: z.array(
      z
        .object({
          id,
          transactionId: id,
          feeType: z.enum(FEE_TYPES),
          amount: money,
        })
        .strict(),
    ),
    feeSchedules: z.array(
      z
        .object({
          id,
          accountId: id,
          feeType: z.enum(FEE_TYPES),
          basis: z.enum(FEE_BASES),
          rateBps: z.number().int().nullable(),
          flatAmount: money.nullable(),
          effectiveFrom: isoDate,
          effectiveTo: isoDate.nullable(),
        })
        .strict(),
    ),
    documents: z.array(
      z
        .object({
          id,
          filename: text,
          storedPath: text,
          mimeType: nullableText,
          byteSize: z.number().int().nonnegative().nullable(),
          sha256: z
            .string()
            .regex(/^[0-9a-f]{64}$/, 'expected a lowercase hex sha-256')
            .nullable(),
          docType: z.enum(DOCUMENT_TYPES).nullable(),
          docDate: isoDate.nullable(),
          extractedText: nullableText,
        })
        .strict(),
    ),
    documentLinks: z.array(
      z
        .object({
          id,
          documentId: id,
          target: z
            .object({
              kind: z.enum(['company', 'payout', 'transaction']),
              id,
            })
            .strict(),
          role: nullableText,
        })
        .strict(),
    ),
  })
  .strict();

export type LedgerDump = z.infer<typeof ledgerDumpSchema>;

type MoneyJson = z.infer<typeof money>;

function outMoney(amount: Money): MoneyJson {
  return { currency: amount.currency.code, minor: amount.minor.toString() };
}

/** The whole ledger, as the plain objects that go into `ledger.json`. */
export function toDump(snapshot: LedgerSnapshot): LedgerDump {
  return {
    traders: snapshot.traders.map((trader) => ({
      id: trader.id,
      code: trader.code,
      name: trader.name,
      notes: trader.notes,
    })),
    companies: snapshot.companies.map((company) => ({
      id: company.id,
      code: company.code,
      name: company.name,
      notes: company.notes,
    })),
    accounts: snapshot.accounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      companyId: account.companyId,
      allowedCurrencies: [...account.allowedCurrencies],
    })),
    payouts: snapshot.payouts.map((payout) => ({
      id: payout.id,
      code: payout.code,
      companyId: payout.companyId,
      traderId: payout.traderId,
      payoutDate: payout.payoutDate,
      reference: payout.reference,
      gross: outMoney(payout.gross),
      charges: outMoney(payout.charges),
      notes: payout.notes,
    })),
    transactions: snapshot.transactions.map((transaction) => ({
      id: transaction.id,
      code: transaction.code,
      payoutId: transaction.payoutId,
      parentId: transaction.parentId,
      txnDate: transaction.txnDate,
      kind: transaction.kind,
      fromAccountId: transaction.fromAccountId,
      toAccountId: transaction.toAccountId,
      fromAmount: outMoney(transaction.fromAmount),
      toAmount: outMoney(transaction.toAmount),
      rate: transaction.rate === null ? null : transaction.rate.toString(),
      fromExternalRef: transaction.fromExternalRef,
      toExternalRef: transaction.toExternalRef,
      fromAddress: transaction.fromAddress,
      toAddress: transaction.toAddress,
      explorerUrl: transaction.explorerUrl,
      notes: transaction.notes,
    })),
    fees: snapshot.fees.map((fee) => ({
      id: fee.id,
      transactionId: fee.transactionId,
      feeType: fee.feeType,
      amount: outMoney(fee.amount),
    })),
    feeSchedules: snapshot.feeSchedules.map((schedule) => ({
      id: schedule.id,
      accountId: schedule.accountId,
      feeType: schedule.feeType,
      basis: schedule.basis,
      rateBps: schedule.rateBps,
      flatAmount:
        schedule.flatAmount === null ? null : outMoney(schedule.flatAmount),
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
    })),
    documents: snapshot.documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      storedPath: document.storedPath,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      docType: document.docType,
      docDate: document.docDate,
      extractedText: document.extractedText,
    })),
    documentLinks: snapshot.documentLinks.map((link) => ({
      id: link.id,
      documentId: link.documentId,
      target: link.target,
      role: link.role,
    })),
  };
}

/** Every currency code the dump mentions, so a restore can check them first. */
export function currenciesUsed(dump: LedgerDump): readonly string[] {
  const codes = new Set<string>();

  for (const payout of dump.payouts) {
    codes.add(payout.gross.currency);
    codes.add(payout.charges.currency);
  }
  for (const transaction of dump.transactions) {
    codes.add(transaction.fromAmount.currency);
    codes.add(transaction.toAmount.currency);
  }
  for (const fee of dump.fees) codes.add(fee.amount.currency);
  for (const schedule of dump.feeSchedules) {
    if (schedule.flatAmount !== null) codes.add(schedule.flatAmount.currency);
  }
  for (const account of dump.accounts) {
    for (const code of account.allowedCurrencies) codes.add(code);
  }

  return [...codes].sort();
}

/**
 * Turn a parsed dump back into entities, ready for `bulkLoad`.
 *
 * Every constructor on the way in is the real one, so §7's invariants — a leg
 * that moves between two different accounts, a rate only where the currency
 * changes, a fee that is not negative — are checked here, before the
 * transaction that writes any of it opens.
 */
export function fromDump(
  dump: LedgerDump,
  currencies: CurrencyRegistry,
): BulkLoad & { readonly documentLinks: readonly DocumentAttachment[] } {
  const inMoney = (amount: MoneyJson): Money =>
    Money.fromMinor(BigInt(amount.minor), currencies.get(amount.currency));

  return {
    traders: dump.traders.map((trader) => Trader.create(trader)),
    companies: dump.companies.map((company) => Company.create(company)),
    accounts: dump.accounts.map((account) => Account.create(account)),
    payouts: dump.payouts.map((payout) =>
      Payout.create({
        ...payout,
        gross: inMoney(payout.gross),
        charges: inMoney(payout.charges),
      }),
    ),
    transactions: dump.transactions.map((transaction) =>
      Transaction.record({
        ...transaction,
        fromAmount: inMoney(transaction.fromAmount),
        toAmount: inMoney(transaction.toAmount),
        rate: transaction.rate === null ? null : BigInt(transaction.rate),
      }),
    ),
    fees: dump.fees.map((fee) =>
      TransactionFee.record({ ...fee, amount: inMoney(fee.amount) }),
    ),
    feeSchedules: dump.feeSchedules.map((schedule) =>
      FeeSchedule.create({
        ...schedule,
        flatAmount:
          schedule.flatAmount === null ? null : inMoney(schedule.flatAmount),
      }),
    ),
    documents: dump.documents.map((document) => Document.create(document)),
    documentLinks: dump.documentLinks,
  };
}
