import type {
  AccountBalanceJson,
  AccountJson,
  CompanyJson,
  TraderJson,
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

/**
 * The two people the ledger keeps payouts for (F24).
 *
 * `DEFAULT_TRADER` is the one `004_traders.sql` creates and §10's tree
 * belongs to; `OTHER_TRADER` exists so a test can switch to somebody and see
 * the figures change rather than merely see a dropdown move.
 */
export const DEFAULT_TRADER: TraderJson = {
  id: 1,
  code: 'default',
  name: 'Me',
  notes: null,
};

export const OTHER_TRADER: TraderJson = {
  id: 2,
  code: 'priya',
  name: 'Priya',
  notes: null,
};

export const TRADERS: readonly TraderJson[] = [DEFAULT_TRADER, OTHER_TRADER];

/** Priya's own award, in a month of its own so a period filter can find it. */
export const OTHER_PAYOUT: PayoutJson = {
  ...REFERENCE_PAYOUT,
  id: 900,
  code: 'TradeifyPayout900',
  traderId: OTHER_TRADER.id,
  payoutDate: '2025-06-04',
  reference: null,
  // A gross of its own, so a test asserting on §10's $1,008.01 is asserting
  // on §10's payout and not on whichever row happened to render first.
  gross: { currency: 'USD', minor: '50000', amount: '500.00' },
  charges: { currency: 'USD', minor: '0', amount: '0.00' },
};

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

/**
 * The five accounts, as `GET /api/accounts` serves them.
 *
 * Derived from the balances dump rather than written again, plus one account
 * that has never taken part in a movement — which is the entire difference
 * between this endpoint and `/api/accounts/balances`, and so has to be in the
 * fixture or no test can see it.
 */
export const ACCOUNTS: readonly AccountJson[] = [
  ...REFERENCE_ACCOUNT_BALANCES.map((entry) => entry.account),
  {
    id: 2,
    code: 'rise',
    name: 'Rise',
    type: 'processor',
    companyId: 2,
    allowedCurrencies: ['USD', 'USDT'],
  },
];

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
