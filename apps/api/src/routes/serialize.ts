import type {
  Account,
  AccountBalance,
  Company,
  DataQualityIssue,
  Document,
  FinancialYearReport,
  Money,
  Payout,
  Trader,
  PayoutTrail,
  Settlement,
  Transaction,
  TransactionFee,
  TrailNode,
} from '@payout/core';

/**
 * Entities to JSON. Pure mapping, no decisions.
 *
 * The one rule that matters: **money leaves as strings.** Both of them —
 * `minor` as a decimal string and `amount` as a formatted one.
 *
 * `minor` is a string because it is a bigint, and `JSON.stringify` throws on
 * a bigint rather than guessing. Converting to `Number` instead would be the
 * guess: 875486900 USDT minor is fine today and a balance two orders of
 * magnitude larger is not, and the failure would be a silently wrong digit
 * rather than an error. N1 says money is never a float; that has to include
 * the wire.
 *
 * `amount` is the same value formatted for a person, derived from the same
 * integer. A client that does arithmetic uses `minor` and its own big-integer
 * type; a client that displays uses `amount`. Neither has a reason to parse
 * the other.
 */

export interface MoneyJson {
  readonly currency: string;
  readonly minor: string;
  readonly amount: string;
}

export function money(value: Money): MoneyJson {
  return {
    currency: value.currency.code,
    minor: value.minor.toString(),
    amount: value.toDecimalString(),
  };
}

export function company(value: Company): Record<string, unknown> {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    notes: value.notes,
  };
}

export function account(value: Account): Record<string, unknown> {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    type: value.type,
    companyId: value.companyId,
    allowedCurrencies: [...value.allowedCurrencies],
  };
}

export function trader(value: Trader): Record<string, unknown> {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    notes: value.notes,
  };
}

export function payout(value: Payout): Record<string, unknown> {
  return {
    id: value.id,
    code: value.code,
    companyId: value.companyId,
    traderId: value.traderId,
    payoutDate: value.payoutDate,
    reference: value.reference,
    gross: money(value.gross),
    charges: money(value.charges),
    notes: value.notes,
  };
}

export function transaction(value: Transaction): Record<string, unknown> {
  return {
    id: value.id,
    code: value.code,
    payoutId: value.payoutId,
    parentId: value.parentId,
    txnDate: value.txnDate,
    kind: value.kind,
    fromAccountId: value.fromAccountId,
    toAccountId: value.toAccountId,
    fromAmount: money(value.fromAmount),
    toAmount: money(value.toAmount),
    // Scaled by 1e8 (§6), as a string for the same reason as `minor`.
    rate: value.rate === null ? null : value.rate.toString(),
    fromExternalRef: value.fromExternalRef,
    toExternalRef: value.toExternalRef,
    notes: value.notes,
  };
}

export function transactionFee(value: TransactionFee): Record<string, unknown> {
  return {
    id: value.id,
    transactionId: value.transactionId,
    feeType: value.feeType,
    amount: money(value.amount),
  };
}

/**
 * A document, without its bytes and without its stored path.
 *
 * The path is deliberately absent. It is an internal filesystem detail, and
 * publishing it invites a client to construct a URL from it — which is the
 * static-mount hole this route layer exists to avoid. Files are reachable by
 * id, through a handler, or not at all.
 */
export function document(value: Document): Record<string, unknown> {
  return {
    id: value.id,
    filename: value.filename,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    sha256: value.sha256,
    docType: value.docType,
    docDate: value.docDate,
  };
}

function trailNode(node: TrailNode): Record<string, unknown> {
  return {
    transaction: transaction(node.transaction),
    fees: node.fees.map(transactionFee),
    documents: node.documents.map(document),
    children: node.children.map(trailNode),
  };
}

export function payoutTrail(value: PayoutTrail): Record<string, unknown> {
  return {
    payout: payout(value.payout),
    // A tree, not a flat list: `children` nests, and a leaf has an empty one.
    roots: value.roots.map(trailNode),
  };
}

export function settlement(value: Settlement): Record<string, unknown> {
  return {
    payout: payout(value.payout),
    status: value.status,
    currency: value.currency.code,
    grossProceeds: money(value.grossProceeds),
    // An object rather than a Map, which `JSON.stringify` renders as `{}`.
    feesByType: Object.fromEntries(
      [...value.feesByType].map(([type, amount]) => [type, money(amount)]),
    ),
    totalFees: money(value.totalFees),
    netCredited: money(value.netCredited),
  };
}

export function accountBalance(value: AccountBalance): Record<string, unknown> {
  return {
    account: account(value.account),
    balance: money(value.balance),
  };
}

export function dataQualityIssue(
  value: DataQualityIssue,
): Record<string, unknown> {
  return {
    subject: value.subject,
    subjectKind: value.subjectKind,
    check: value.check,
    detail: value.detail,
  };
}

export function financialYearReport(
  value: FinancialYearReport,
): Record<string, unknown> {
  return {
    range: { from: value.range.from, to: value.range.to },
    currency: value.currency.code,
    totalCredited: money(value.totalCredited),
    totalTds: money(value.totalTds),
    totalFees: money(value.totalFees),
    byCompany: value.byCompany.map((entry) => ({
      company: company(entry.company),
      payoutCount: entry.payoutCount,
      credited: money(entry.credited),
      tds: money(entry.tds),
      fees: money(entry.fees),
    })),
  };
}
