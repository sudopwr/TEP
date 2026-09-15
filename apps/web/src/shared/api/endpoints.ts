import { request } from './client';
import type {
  AccountJson,
  AccountsResponse,
  BalancesResponse,
  ChangeCredentialsCommand,
  CompaniesResponse,
  CompanyJson,
  CreateAccountCommand,
  CreateCompanyCommand,
  CreatePayoutCommand,
  CreateSaleCommand,
  CreateTransactionCommand,
  CredentialsChangedJson,
  DataQualityResponse,
  DocumentAttachedJson,
  DocumentsResponse,
  FinancialYearFilter,
  FinancialYearReportJson,
  PayoutDeletedJson,
  PayoutFilter,
  PayoutJson,
  PayoutTrailJson,
  PayoutsResponse,
  SaleRecordedJson,
  SessionUserJson,
  SettlementJson,
  SignInCommand,
  TransactionJson,
  TransactionsResponse,
} from './types';

/**
 * One function per endpoint: a typed call, and nothing else.
 *
 * Deliberately free of TanStack. These are plain async functions, so the hooks
 * layer above can be read as "which cache key, which invalidations" without
 * URLs and query strings mixed in — and so a test can call one directly
 * without mounting a component.
 */

/** Drop undefined entries, so `?companyId=undefined` never reaches the API. */
function queryString(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(name, String(value));
    }
  }

  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

// ---------- Auth ----------

/**
 * The signed-in user, or null.
 *
 * 401 is a normal answer here — it means nobody is signed in — so it is turned
 * into `null` rather than thrown. Every other failure still throws: a 500 from
 * this endpoint means the server is broken, which is not the same as being
 * signed out and must not render as a sign-in screen.
 */
export async function fetchMe(
  signal?: AbortSignal,
): Promise<SessionUserJson | null> {
  try {
    return await request<SessionUserJson>('/auth/me', wrapSignal(signal));
  } catch (error: unknown) {
    if (isUnauthenticated(error)) {
      return null;
    }
    throw error;
  }
}

export function signIn(command: SignInCommand): Promise<SessionUserJson> {
  return request<SessionUserJson>('/auth/login', {
    method: 'POST',
    body: command,
  });
}

export function signOut(): Promise<null> {
  // 204, so there is no body to parse.
  return request<null>('/auth/logout', { method: 'POST' });
}

export function changeCredentials(
  command: ChangeCredentialsCommand,
): Promise<CredentialsChangedJson> {
  return request<CredentialsChangedJson>('/auth/change-credentials', {
    method: 'POST',
    body: command,
  });
}

// ---------- Companies ----------

export function fetchCompanies(
  signal?: AbortSignal,
): Promise<CompaniesResponse> {
  return request<CompaniesResponse>('/api/companies', wrapSignal(signal));
}

export function createCompany(
  command: CreateCompanyCommand,
): Promise<{ company: CompanyJson }> {
  return request<{ company: CompanyJson }>('/api/companies', {
    method: 'POST',
    body: command,
  });
}

// ---------- Accounts ----------

export function fetchAccounts(
  type?: string,
  signal?: AbortSignal,
): Promise<AccountsResponse> {
  return request<AccountsResponse>(
    `/api/accounts${queryString({ type })}`,
    wrapSignal(signal),
  );
}

export function createAccount(
  command: CreateAccountCommand,
): Promise<{ account: AccountJson }> {
  return request<{ account: AccountJson }>('/api/accounts', {
    method: 'POST',
    body: command,
  });
}

// ---------- Payouts ----------

export function fetchPayouts(
  filter: PayoutFilter = {},
  signal?: AbortSignal,
): Promise<PayoutsResponse> {
  return request<PayoutsResponse>(
    `/api/payouts${queryString({
      companyId: filter.companyId,
      from: filter.from,
      to: filter.to,
    })}`,
    wrapSignal(signal),
  );
}

export function createPayout(
  command: CreatePayoutCommand,
): Promise<{ payout: PayoutJson }> {
  return request<{ payout: PayoutJson }>('/api/payouts', {
    method: 'POST',
    body: command,
  });
}

export function deletePayout(payoutId: number): Promise<PayoutDeletedJson> {
  return request<PayoutDeletedJson>(`/api/payouts/${String(payoutId)}`, {
    method: 'DELETE',
  });
}

export function fetchPayoutTrail(
  payoutId: number,
  signal?: AbortSignal,
): Promise<PayoutTrailJson> {
  return request<PayoutTrailJson>(
    `/api/payouts/${String(payoutId)}/trail`,
    wrapSignal(signal),
  );
}

export function fetchSettlement(
  payoutId: number,
  currencyCode?: string,
  signal?: AbortSignal,
): Promise<SettlementJson> {
  return request<SettlementJson>(
    `/api/payouts/${String(payoutId)}/settlement${queryString({ currencyCode })}`,
    wrapSignal(signal),
  );
}

// ---------- Transactions ----------

export function fetchTransactions(
  payoutId?: number,
  signal?: AbortSignal,
): Promise<TransactionsResponse> {
  return request<TransactionsResponse>(
    `/api/transactions${queryString({ payoutId })}`,
    wrapSignal(signal),
  );
}

/**
 * One endpoint, two response shapes.
 *
 * A movement answers `{ transaction }`; a sale answers that plus the gross
 * proceeds, the derived fees and the net — because the server computed them
 * and the caller has no way to know them in advance. The overloads keep that
 * asymmetry visible at the call site instead of hiding it behind a union
 * everybody has to narrow.
 */
export function createTransaction(
  command: CreateSaleCommand,
): Promise<SaleRecordedJson>;
export function createTransaction(
  command: CreateTransactionCommand,
): Promise<{ transaction: TransactionJson } | SaleRecordedJson>;
export function createTransaction(
  command: CreateTransactionCommand,
): Promise<{ transaction: TransactionJson } | SaleRecordedJson> {
  return request<{ transaction: TransactionJson } | SaleRecordedJson>(
    '/api/transactions',
    { method: 'POST', body: command },
  );
}

// ---------- Documents ----------

export function searchDocuments(
  query: string,
  signal?: AbortSignal,
): Promise<DocumentsResponse> {
  return request<DocumentsResponse>(
    `/api/documents/search${queryString({ q: query })}`,
    wrapSignal(signal),
  );
}

/**
 * The one multipart call. `FormData` sets its own content-type — including the
 * boundary — so this bypasses the JSON helper rather than fighting it.
 */
export function attachDocument(input: {
  readonly transactionId: number;
  readonly file: File;
  readonly docType?: string;
  readonly docDate?: string;
  readonly role?: string;
}): Promise<DocumentAttachedJson> {
  const form = new FormData();
  form.set('file', input.file);
  if (input.docType !== undefined) form.set('docType', input.docType);
  if (input.docDate !== undefined) form.set('docDate', input.docDate);
  if (input.role !== undefined) form.set('role', input.role);

  return request<DocumentAttachedJson>(
    `/api/transactions/${String(input.transactionId)}/documents`,
    { method: 'POST', formData: form },
  );
}

/** The URL a document is served from. Behind both guards — never a static mount. */
export function documentUrl(documentId: number): string {
  return `/api/documents/${String(documentId)}`;
}

// ---------- Balances, checks, reports ----------

export function fetchBalances(
  payoutId?: number,
  signal?: AbortSignal,
): Promise<BalancesResponse> {
  return request<BalancesResponse>(
    `/api/accounts/balances${queryString({ payoutId })}`,
    wrapSignal(signal),
  );
}

export function fetchDataQuality(
  payoutId?: number,
  tolerancePct?: number,
  signal?: AbortSignal,
): Promise<DataQualityResponse> {
  return request<DataQualityResponse>(
    `/api/data-quality${queryString({ payoutId, tolerancePct })}`,
    wrapSignal(signal),
  );
}

export function fetchFinancialYear(
  filter: FinancialYearFilter,
  signal?: AbortSignal,
): Promise<FinancialYearReportJson> {
  return request<FinancialYearReportJson>(
    `/api/reports/financial-year${queryString({
      from: filter.from,
      to: filter.to,
      currencyCode: filter.currencyCode,
    })}`,
    wrapSignal(signal),
  );
}

/** `exactOptionalPropertyTypes` refuses `{ signal: undefined }`. */
function wrapSignal(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function isUnauthenticated(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isUnauthenticated' in error &&
    (error as { isUnauthenticated: boolean }).isUnauthenticated
  );
}
