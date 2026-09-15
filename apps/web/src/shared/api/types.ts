/**
 * The wire shapes, mirroring `apps/api/src/routes/serialize.ts`.
 *
 * Hand-written rather than generated, and that is a cost worth naming: these
 * can drift from the server. What stops the drift being silent is that every
 * hook test runs against MSW handlers built from the same fixtures the API's
 * own integration tests assert — so a server field that changes shape fails a
 * test here rather than rendering `undefined` in a table.
 */

/**
 * Money as it crosses the wire: an integer and a formatted string.
 *
 * `minor` is a string because it is a bigint on the server and JSON has no
 * bigint. It is the value; `amount` is the server's own rendering of it, kept
 * for anything that must match the server byte for byte. `MoneyDisplay` takes
 * `minor` and formats for the browser's locale.
 */
export interface MoneyJson {
  readonly currency: string;
  readonly minor: string;
  readonly amount: string;
}

export interface CompanyJson {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly notes: string | null;
}

export type AccountType =
  'prop_firm' | 'processor' | 'exchange' | 'wallet' | 'bank';

export interface AccountJson {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly companyId: number | null;
  readonly allowedCurrencies: readonly string[];
}

export interface PayoutJson {
  readonly id: number;
  readonly code: string;
  readonly companyId: number;
  readonly payoutDate: string;
  readonly reference: string | null;
  readonly gross: MoneyJson;
  readonly charges: MoneyJson;
  readonly notes: string | null;
}

/**
 * What a delete took with it (F2).
 *
 * The payout is the row as it was: there is nothing on file with that id by
 * the time this arrives, and the toast still has to be able to name it.
 */
export interface PayoutDeletedJson {
  readonly payout: PayoutJson;
  readonly transactionsDeleted: number;
  readonly feesDeleted: number;
}

export type TransactionKind =
  'payout_credit' | 'withdrawal' | 'transfer' | 'sale' | 'deposit';

export interface TransactionJson {
  readonly id: number;
  readonly code: string;
  readonly payoutId: number;
  readonly parentId: number | null;
  readonly txnDate: string;
  readonly kind: TransactionKind;
  readonly fromAccountId: number;
  readonly toAccountId: number;
  readonly fromAmount: MoneyJson;
  readonly toAmount: MoneyJson;
  /** Scaled by 1e8 (§6), as a string for the same reason as `minor`. */
  readonly rate: string | null;
  readonly fromExternalRef: string | null;
  readonly toExternalRef: string | null;
  readonly notes: string | null;
}

export type FeeType =
  'tds' | 'exchange_fee' | 'gst' | 'network_fee' | 'platform_charge';

export interface TransactionFeeJson {
  readonly id: number;
  readonly transactionId: number;
  readonly feeType: FeeType;
  readonly amount: MoneyJson;
}

/** No `storedPath`: files are reachable by id through a handler, or not at all. */
export interface DocumentJson {
  readonly id: number;
  readonly filename: string;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly sha256: string | null;
  readonly docType: string | null;
  readonly docDate: string | null;
}

export interface TrailNodeJson {
  readonly transaction: TransactionJson;
  readonly fees: readonly TransactionFeeJson[];
  readonly documents: readonly DocumentJson[];
  readonly children: readonly TrailNodeJson[];
}

export interface PayoutTrailJson {
  readonly payout: PayoutJson;
  readonly roots: readonly TrailNodeJson[];
}

export type PayoutStatus = 'open' | 'settled';

export interface SettlementJson {
  readonly payout: PayoutJson;
  /** Derived on every read, never stored (§13). */
  readonly status: PayoutStatus;
  readonly currency: string;
  readonly grossProceeds: MoneyJson;
  readonly feesByType: Readonly<Partial<Record<FeeType, MoneyJson>>>;
  readonly totalFees: MoneyJson;
  readonly netCredited: MoneyJson;
}

export interface AccountBalanceJson {
  readonly account: AccountJson;
  readonly balance: MoneyJson;
}

export interface DataQualityIssueJson {
  readonly subject: string;
  readonly subjectKind: 'transaction' | 'payout';
  readonly check: string;
  readonly detail: string;
}

export interface CompanyTotalsJson {
  readonly company: CompanyJson;
  readonly payoutCount: number;
  readonly credited: MoneyJson;
  readonly tds: MoneyJson;
  readonly fees: MoneyJson;
}

export interface FinancialYearReportJson {
  readonly range: { readonly from: string; readonly to: string };
  readonly currency: string;
  readonly totalCredited: MoneyJson;
  readonly totalTds: MoneyJson;
  readonly totalFees: MoneyJson;
  readonly byCompany: readonly CompanyTotalsJson[];
}

export interface SessionUserJson {
  readonly username: string;
  readonly mustChangePassword: boolean;
}

export interface CredentialsChangedJson extends SessionUserJson {
  readonly passwordChanged: boolean;
  readonly usernameChanged: boolean;
  readonly otherSessionsRevoked: number;
}

export interface SaleRecordedJson {
  readonly transaction: TransactionJson;
  readonly grossProceeds: MoneyJson;
  readonly fees: readonly TransactionFeeJson[];
  readonly totalFees: MoneyJson;
  readonly netCredited: MoneyJson;
}

export interface DocumentAttachedJson {
  readonly document: DocumentJson;
  /** False when the bytes were already on file and only a link was added. */
  readonly created: boolean;
}

// ---------- Envelopes ----------

export interface CompaniesResponse {
  readonly companies: readonly CompanyJson[];
}
export interface PayoutsResponse {
  readonly payouts: readonly PayoutJson[];
}
export interface TransactionsResponse {
  readonly transactions: readonly TransactionJson[];
}
export interface AccountsResponse {
  readonly accounts: readonly AccountJson[];
}
export interface BalancesResponse {
  readonly balances: readonly AccountBalanceJson[];
}
export interface DataQualityResponse {
  readonly issues: readonly DataQualityIssueJson[];
}
export interface DocumentsResponse {
  readonly documents: readonly DocumentJson[];
}

// ---------- Command shapes ----------

export interface CreateCompanyCommand {
  readonly code: string;
  readonly name: string;
  readonly notes?: string | null;
}

export interface CreateAccountCommand {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly companyId?: number | null;
  /** Omitted or empty both mean "holds anything" — see `Account.allows`. */
  readonly allowedCurrencies?: readonly string[];
}

export interface CreatePayoutCommand {
  readonly code: string;
  readonly companyId: number;
  readonly payoutDate?: string;
  readonly grossAmount: string;
  readonly currencyCode: string;
  readonly charges?: string;
  readonly reference?: string | null;
  readonly notes?: string | null;
}

/** A movement. Amounts and rates are strings — N1 reaches the wire too. */
export interface CreateMovementCommand {
  readonly kind: Exclude<TransactionKind, 'sale'>;
  readonly code: string;
  readonly payoutId: number;
  readonly parentId?: number | null;
  readonly txnDate: string;
  readonly fromAccountId: number;
  readonly toAccountId: number;
  readonly fromAmount: string;
  readonly fromCurrencyCode: string;
  readonly toAmount: string;
  readonly toCurrencyCode: string;
  readonly rate?: string | null;
  readonly notes?: string | null;
}

/** A sale. No `toAmount`: gross proceeds come from the rate (§13). */
export interface CreateSaleCommand {
  readonly kind: 'sale';
  readonly code: string;
  readonly payoutId: number;
  readonly parentId?: number | null;
  readonly txnDate: string;
  readonly fromAccountId: number;
  readonly toAccountId: number;
  readonly fromAmount: string;
  readonly fromCurrencyCode: string;
  readonly rate: string;
  readonly settlementCurrencyCode: string;
  readonly tds?: string | null;
  readonly notes?: string | null;
}

export type CreateTransactionCommand =
  CreateMovementCommand | CreateSaleCommand;

export interface SignInCommand {
  readonly username: string;
  readonly password: string;
}

export interface ChangeCredentialsCommand {
  readonly currentPassword: string;
  readonly newUsername?: string;
  readonly newPassword?: string;
}

export interface PayoutFilter {
  readonly companyId?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface FinancialYearFilter {
  readonly from: string;
  readonly to: string;
  readonly currencyCode?: string;
}
