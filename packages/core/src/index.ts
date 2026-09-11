/**
 * packages/core — the domain.
 *
 * Zero runtime dependencies, by design and by lint rule. Nothing in here
 * may import from outside this directory: no Fastify, no SQLite, no React,
 * not even `node:*`. Anything the outside world must provide arrives as a
 * port interface defined here and implemented in apps/api.
 */
export type {
  AccountId,
  CompanyId,
  DocumentId,
  FeeScheduleId,
  IsoDate,
  IsoInstant,
  PayoutId,
  SessionId,
  TransactionFeeId,
  TransactionId,
  UserId,
} from './domain/ids';

export type { Currency } from './domain/currency';
export {
  CurrencyRegistry,
  currencies,
  INR,
  USD,
  USDT,
} from './domain/currency';

export type { RoundingMode } from './domain/money';
export { Money, RATE_SCALE } from './domain/money';

export type { CompanyProps } from './domain/company';
export { Company } from './domain/company';

export type { AccountProps, AccountType } from './domain/account';
export { Account } from './domain/account';

export type { PayoutProps, PayoutStatus } from './domain/payout';
export { Payout } from './domain/payout';

export type { TransactionKind, TransactionProps } from './domain/transaction';
export { TRANSACTION_KINDS, Transaction } from './domain/transaction';

export type { FeeType, TransactionFeeProps } from './domain/transaction-fee';
export { FEE_TYPES, TransactionFee } from './domain/transaction-fee';

export type { DocumentProps, DocumentType } from './domain/document';
export { DOCUMENT_TYPES, Document } from './domain/document';

export type { FeeBasis, FeeScheduleProps } from './domain/fee-schedule';
export { FeeSchedule } from './domain/fee-schedule';

export type { UserProps } from './domain/user';
export { User } from './domain/user';

export type { SessionProps } from './domain/session';
export { SESSION_LIFETIME_MS, Session } from './domain/session';

export type {
  PasswordPolicyContext,
  PasswordPolicyResult,
  PasswordPolicyViolation,
} from './domain/password-policy';
export {
  MINIMUM_PASSWORD_LENGTH,
  checkPasswordPolicy,
  commonPasswords,
} from './domain/password-policy';

export type {
  DiscrepancyReason,
  ExpectedFee,
  FeeDiscrepancy,
  FeeEngineOptions,
} from './domain/fee-engine';
export { compareToActual, expectedFees } from './domain/fee-engine';

export * from './ports/index';
export * from './usecases/index';

export {
  AccountNotFoundError,
  AmbiguousFeeScheduleError,
  AuthenticationFailedError,
  CompanyCodeTakenError,
  DocumentFileMissingError,
  DocumentNotFoundError,
  InvalidUsernameError,
  PasswordPolicyError,
  SessionInvalidError,
  UserNotFoundError,
  UsernameTakenError,
  CompanyNotFoundError,
  CurrencyMismatchError,
  CurrencyNotAllowedError,
  DomainError,
  TransactionNotFoundError,
  InvalidFeeScheduleError,
  UnresolvableFeeBasisError,
  InvalidBasisPointsError,
  InvalidCurrencyError,
  InvalidDecimalStringError,
  InvalidMoneyAmountError,
  InvalidRateError,
  InvalidRoundingModeError,
  NonPositiveAmountError,
  ParentPayoutMismatchError,
  PayoutNotFoundError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
  UnknownCurrencyError,
} from './domain/errors';
