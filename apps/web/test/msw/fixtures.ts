import type {
  AccountBalanceJson,
  CompanyJson,
  DataQualityIssueJson,
  DocumentJson,
  FinancialYearReportJson,
  PayoutJson,
  PayoutTrailJson,
  SettlementJson,
  TransactionJson,
} from '../../src/shared/api/types';

import {
  REFERENCE_ACCOUNT_BALANCES,
  REFERENCE_COMPANIES,
  REFERENCE_ISSUES,
  REFERENCE_PAYOUT,
  REFERENCE_REPORT,
  REFERENCE_SETTLEMENT,
  REFERENCE_TRAIL,
  REFERENCE_TRANSACTIONS,
} from './reference-payout';

/**
 * The names the tests use, pointing at the real thing.
 *
 * Everything here comes from `reference-payout.ts`, which was dumped from the
 * API's own test server running the §10 fixture. That matters more than it
 * looks: a component test against invented data proves the component renders
 * *something*, while these prove it renders ₹84,642.93 — through a trail four
 * levels deep whose four sales have to add up.
 */

export const TRADEIFY: CompanyJson = REFERENCE_COMPANIES[0] as CompanyJson;
export const RISE_CO: CompanyJson = REFERENCE_COMPANIES[1] as CompanyJson;

export const PAYOUT: PayoutJson = REFERENCE_PAYOUT;
export const TRANSACTIONS: readonly TransactionJson[] = REFERENCE_TRANSACTIONS;
export const TRAIL: PayoutTrailJson = REFERENCE_TRAIL;

/** §10 exactly: gross ₹86,027.56, fees ₹1,384.63, net ₹84,642.93. */
export const SETTLEMENT: SettlementJson = REFERENCE_SETTLEMENT;

/**
 * The same payout before its last sale reached the bank.
 *
 * Kept because `useSettlePayout` can only be exercised against a payout that
 * is *not* settled yet — optimistically flipping a status that is already
 * `settled` would prove nothing. Status is derived from whether a sale leg
 * reached a bank account (§13), so this is a real state the same payout
 * passed through, not a fabricated one.
 */
export const OPEN_SETTLEMENT: SettlementJson = {
  ...REFERENCE_SETTLEMENT,
  status: 'open',
};

/** §10's balances, both dust figures and the negative prop-firm row. */
export const BALANCES: readonly AccountBalanceJson[] =
  REFERENCE_ACCOUNT_BALANCES;

export const ISSUES: readonly DataQualityIssueJson[] = REFERENCE_ISSUES;

export const REPORT: FinancialYearReportJson = REFERENCE_REPORT;

/**
 * Documents, which the reference database has none of.
 *
 * The importer brings companies, accounts, payouts, transactions and fees;
 * attaching a file is an interactive act (UC4), so there is nothing to dump.
 * These are written by hand and say so.
 */
export const DOCUMENTS: readonly DocumentJson[] = [
  {
    id: 10,
    filename: 'coindcx-march.pdf',
    mimeType: 'application/pdf',
    byteSize: 20480,
    sha256: 'a'.repeat(64),
    docType: 'statement',
    docDate: '2025-03-31',
  },
];
