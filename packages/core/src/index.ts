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
  IsoDate,
  PayoutId,
  TransactionFeeId,
  TransactionId,
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
export { Transaction } from './domain/transaction';

export type { FeeType, TransactionFeeProps } from './domain/transaction-fee';
export { TransactionFee } from './domain/transaction-fee';

export type { DocumentProps, DocumentType } from './domain/document';
export { Document } from './domain/document';

export {
  CurrencyMismatchError,
  CurrencyNotAllowedError,
  DomainError,
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
