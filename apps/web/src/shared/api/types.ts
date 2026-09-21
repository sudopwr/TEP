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

/**
 * A person the ledger keeps payouts for (F24).
 *
 * Not a `SessionUserJson`. That one is the single account that signs in
 * (§5a); this is somebody the money belongs to, and there is no password
 * anywhere in this shape because a trader never signs in.
 */
export interface TraderJson {
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
  /** Whose award it is (F24). Every payout belongs to somebody. */
  readonly traderId: number;
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

/**
 * What a leg's delete took with it (F20).
 *
 * `transactionsDeleted` includes the leg itself, so 1 means it had nothing
 * below it; `payoutId` says which trail, settlement and checks to re-read.
 */
export interface TransactionDeletedJson {
  readonly transaction: TransactionJson;
  readonly payoutId: number;
  readonly transactionsDeleted: number;
  readonly feesDeleted: number;
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
export interface TradersResponse {
  readonly traders: readonly TraderJson[];
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
/**
 * What a document's delete took with it (F22).
 *
 * `linksRemoved` is how many things lost their evidence — one file may be
 * attached to several (F6), and the reader may have seen only one of them.
 */
export interface DocumentDeletedJson {
  readonly document: DocumentJson;
  readonly linksRemoved: number;
}

/** Where a document may be attached (F6): a payout, or one of its legs. */
export type DocumentTargetJson =
  | { readonly kind: 'payout'; readonly id: number }
  | { readonly kind: 'transaction'; readonly id: number };

export interface LinkDocumentCommand {
  readonly documentId: number;
  readonly target: DocumentTargetJson;
  readonly role?: string;
}

/** What a detach left behind: the document, and what still points at it. */
export interface DocumentDetachedJson {
  readonly document: DocumentJson;
  readonly remainingLinks: number;
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

/**
 * An edit is a **replacement**, which is why it carries the whole account and
 * not the fields that changed: the allow-list's empty value means "holds
 * anything", so a partial shape would have no way to say it (see
 * `updateAccountBody` on the server).
 */
export interface UpdateAccountCommand {
  readonly accountId: number;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly companyId?: number | null;
  readonly allowedCurrencies?: readonly string[];
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
  readonly traderId: number;
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

/**
 * What a leg may be corrected to (F21) — the row, and only the row.
 *
 * No `kind`, no `parentId`, no `payoutId`: none of the three is a correction
 * of this leg, and the server refuses a body carrying them. The rate is a
 * decimal string like every other number here; §6's 1e8 scaling happens at
 * the edge, never in the browser.
 */
export interface UpdateTransactionCommand {
  readonly transactionId: number;
  readonly code: string;
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

export interface SignInCommand {
  readonly username: string;
  readonly password: string;
}

export interface ChangeCredentialsCommand {
  readonly currentPassword: string;
  readonly newUsername?: string;
  readonly newPassword?: string;
}

export interface CreateTraderCommand {
  readonly code: string;
  readonly name: string;
  readonly notes?: string | null;
}

/**
 * The selection every scoped screen shares (F24): whose money, and when.
 *
 * One shape rather than three loose arguments, because the four screens that
 * honour it — the payout list, the balances, the checks and the report — must
 * honour it identically. It is also a cache key, so it is a plain object of
 * primitives: TanStack hashes it structurally, and two screens that built the
 * same selection read the same entry.
 */
export interface ScopeFilter {
  readonly traderId?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface PayoutFilter extends ScopeFilter {
  readonly companyId?: number;
}

export interface FinancialYearFilter {
  readonly from: string;
  readonly to: string;
  readonly currencyCode?: string;
  /** The trader half of the scope; the range is this report's own (F24). */
  readonly traderId?: number;
}
