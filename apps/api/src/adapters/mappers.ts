import {
  Account,
  Company,
  Document,
  FeeSchedule,
  Money,
  Payout,
  Session,
  Transaction,
  TransactionFee,
  User,
  type AccountType,
  type Currency,
  type CurrencyRegistry,
  type DocumentType,
  type FeeBasis,
  type FeeType,
  type TransactionKind,
} from '@payout/core';

/**
 * A row that cannot become an entity.
 *
 * Every case here is something the schema permits but the domain does not — a
 * nullable column the entity requires, or a flat fee schedule with no currency.
 * That is a defect in the data or in the schema, never in user input, so it is
 * loud rather than silently coerced.
 */
export class RowMappingError extends Error {
  constructor(
    readonly table: string,
    readonly column: string,
    reason: string,
  ) {
    super(`Cannot map ${table}.${column}: ${reason}.`);
    this.name = 'RowMappingError';
  }
}

// ---------- Row shapes ----------
//
// Integer columns arrive as bigint, because the connection sets
// defaultSafeIntegers so that a money column never passes through a float64.
// Narrowing back to number happens here and nowhere else, and only for values
// that are small by nature: ids, scales, byte counts.

export interface CompanyRow {
  readonly id: bigint;
  readonly code: string;
  readonly name: string;
  readonly notes: string | null;
}

export interface AccountRow {
  readonly id: bigint;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly company_id: bigint | null;
}

export interface PayoutRow {
  readonly id: bigint;
  readonly code: string;
  readonly company_id: bigint;
  readonly payout_date: string;
  readonly reference: string | null;
  readonly gross_amount: bigint;
  readonly charges: bigint;
  readonly currency_code: string;
  readonly notes: string | null;
}

export interface TransactionRow {
  readonly id: bigint;
  readonly code: string;
  readonly payout_id: bigint;
  readonly parent_id: bigint | null;
  readonly txn_date: string;
  readonly kind: string;
  readonly from_account_id: bigint;
  readonly to_account_id: bigint;
  readonly from_amount: bigint;
  readonly from_currency: string;
  readonly to_amount: bigint;
  readonly to_currency: string;
  readonly rate_applied: bigint | null;
  readonly from_external_ref: string | null;
  readonly to_external_ref: string | null;
  readonly notes: string | null;
}

export interface TransactionFeeRow {
  readonly id: bigint;
  readonly transaction_id: bigint;
  readonly fee_type: string;
  readonly amount: bigint;
  readonly currency_code: string;
}

export interface DocumentRow {
  readonly id: bigint;
  readonly filename: string;
  readonly stored_path: string;
  readonly mime_type: string | null;
  readonly byte_size: bigint | null;
  readonly sha256: string | null;
  readonly doc_type: string | null;
  readonly doc_date: string | null;
  readonly extracted_text: string | null;
}

export interface FeeScheduleRow {
  readonly id: bigint;
  readonly account_id: bigint;
  readonly fee_type: string;
  readonly basis: string;
  readonly rate_bps: bigint | null;
  readonly flat_amount: bigint | null;
  readonly currency_code: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

// ---------- Narrowing helpers ----------

/** An id is a row number, not an amount. Narrowing it is safe and explicit. */
function toId(value: bigint, table: string, column: string): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RowMappingError(
      table,
      column,
      `${String(value)} is outside the safe integer range`,
    );
  }
  return Number(value);
}

function currencyOf(currencies: CurrencyRegistry, code: string): Currency {
  return currencies.get(code);
}

function money(
  amount: bigint,
  code: string,
  currencies: CurrencyRegistry,
): Money {
  return Money.fromMinor(amount, currencyOf(currencies, code));
}

// ---------- Row to entity ----------

export function toCompany(row: CompanyRow): Company {
  return Company.create({
    id: toId(row.id, 'companies', 'id'),
    code: row.code,
    name: row.name,
    notes: row.notes,
  });
}

export function toAccount(
  row: AccountRow,
  allowedCurrencies: readonly string[],
): Account {
  return Account.create({
    id: toId(row.id, 'accounts', 'id'),
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    companyId:
      row.company_id === null
        ? null
        : toId(row.company_id, 'accounts', 'company_id'),
    allowedCurrencies,
  });
}

export function toPayout(row: PayoutRow, currencies: CurrencyRegistry): Payout {
  return Payout.create({
    id: toId(row.id, 'payouts', 'id'),
    code: row.code,
    companyId: toId(row.company_id, 'payouts', 'company_id'),
    payoutDate: row.payout_date,
    reference: row.reference,
    gross: money(row.gross_amount, row.currency_code, currencies),
    charges: money(row.charges, row.currency_code, currencies),
    notes: row.notes,
  });
}

export function toTransaction(
  row: TransactionRow,
  currencies: CurrencyRegistry,
): Transaction {
  return Transaction.record({
    id: toId(row.id, 'transactions', 'id'),
    code: row.code,
    payoutId: toId(row.payout_id, 'transactions', 'payout_id'),
    parentId:
      row.parent_id === null
        ? null
        : toId(row.parent_id, 'transactions', 'parent_id'),
    txnDate: row.txn_date,
    kind: row.kind as TransactionKind,
    fromAccountId: toId(row.from_account_id, 'transactions', 'from_account_id'),
    toAccountId: toId(row.to_account_id, 'transactions', 'to_account_id'),
    fromAmount: money(row.from_amount, row.from_currency, currencies),
    toAmount: money(row.to_amount, row.to_currency, currencies),
    rate: row.rate_applied,
    fromExternalRef: row.from_external_ref,
    toExternalRef: row.to_external_ref,
    notes: row.notes,
  });
}

export function toTransactionFee(
  row: TransactionFeeRow,
  currencies: CurrencyRegistry,
): TransactionFee {
  return TransactionFee.record({
    id: toId(row.id, 'transaction_fees', 'id'),
    transactionId: toId(
      row.transaction_id,
      'transaction_fees',
      'transaction_id',
    ),
    feeType: row.fee_type as FeeType,
    amount: money(row.amount, row.currency_code, currencies),
  });
}

export function toDocument(row: DocumentRow): Document {
  return Document.create({
    id: toId(row.id, 'documents', 'id'),
    filename: row.filename,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    byteSize:
      row.byte_size === null
        ? null
        : toId(row.byte_size, 'documents', 'byte_size'),
    sha256: row.sha256,
    docType: row.doc_type as DocumentType | null,
    docDate: row.doc_date,
    extractedText: row.extracted_text,
  });
}

export function toFeeSchedule(
  row: FeeScheduleRow,
  currencies: CurrencyRegistry,
): FeeSchedule {
  let flatAmount: Money | null = null;

  if (row.flat_amount !== null) {
    if (row.currency_code === null) {
      throw new RowMappingError(
        'fee_schedules',
        'currency_code',
        `a flat amount of ${String(row.flat_amount)} means nothing without a currency`,
      );
    }
    flatAmount = money(row.flat_amount, row.currency_code, currencies);
  }

  return FeeSchedule.create({
    id: toId(row.id, 'fee_schedules', 'id'),
    accountId: toId(row.account_id, 'fee_schedules', 'account_id'),
    feeType: row.fee_type as FeeType,
    basis: row.basis as FeeBasis,
    rateBps:
      row.rate_bps === null
        ? null
        : toId(row.rate_bps, 'fee_schedules', 'rate_bps'),
    flatAmount,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  });
}

// ---------- Authentication ----------

export interface UserRow {
  readonly id: bigint;
  readonly username: string;
  readonly password_hash: string;
  /** SQLite has no boolean; the CHECK constrains it to 0 or 1. */
  readonly must_change_password: bigint;
  readonly created_at: string;
  readonly password_changed_at: string | null;
}

export interface SessionRow {
  /** TEXT, not INTEGER: a session id is a bearer secret, not a row number. */
  readonly id: string;
  readonly user_id: bigint;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

export function toUser(row: UserRow): User {
  return User.create({
    id: toId(row.id, 'users', 'id'),
    username: row.username,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password !== 0n,
    createdAt: row.created_at,
    passwordChangedAt: row.password_changed_at,
  });
}

export function toSession(row: SessionRow): Session {
  return Session.create({
    id: row.id,
    userId: toId(row.user_id, 'sessions', 'user_id'),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  });
}
