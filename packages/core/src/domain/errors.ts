/**
 * Typed domain errors. Never throw a bare string, never throw a plain Error
 * from the domain — a caller must be able to branch on the type.
 */

export abstract class DomainError extends Error {
  protected constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** Arithmetic was attempted across two different currencies. */
export class CurrencyMismatchError extends DomainError {
  constructor(
    readonly operation: string,
    readonly left: string,
    readonly right: string,
  ) {
    super(
      'CurrencyMismatchError',
      `Cannot ${operation} ${right} to ${left}: money is only comparable within a single currency.`,
    );
  }
}

/** A minor-unit amount that is not a whole number, or is out of safe range. */
export class InvalidMoneyAmountError extends DomainError {
  constructor(
    readonly value: unknown,
    readonly reason: string,
  ) {
    super(
      'InvalidMoneyAmountError',
      `Invalid minor-unit amount ${String(value)}: ${reason}.`,
    );
  }
}

/** A decimal string that cannot be represented exactly in its currency. */
export class InvalidDecimalStringError extends DomainError {
  constructor(
    readonly text: string,
    readonly currencyCode: string,
    readonly reason: string,
  ) {
    super(
      'InvalidDecimalStringError',
      `Cannot read '${text}' as ${currencyCode}: ${reason}.`,
    );
  }
}

/** A conversion rate that is not a positive whole number of 1e-8 units. */
export class InvalidRateError extends DomainError {
  constructor(
    readonly value: unknown,
    readonly reason: string,
  ) {
    super('InvalidRateError', `Invalid rate ${String(value)}: ${reason}.`);
  }
}

/** A basis-points figure that is not a non-negative whole number. */
export class InvalidBasisPointsError extends DomainError {
  constructor(
    readonly value: unknown,
    readonly reason: string,
  ) {
    super(
      'InvalidBasisPointsError',
      `Invalid basis points ${String(value)}: ${reason}.`,
    );
  }
}

/** A rounding mode outside the supported set. */
export class InvalidRoundingModeError extends DomainError {
  constructor(readonly mode: unknown) {
    super(
      'InvalidRoundingModeError',
      `Unknown rounding mode ${String(mode)}. Rounding must always be stated explicitly.`,
    );
  }
}

/**
 * A transaction whose two sides are the same account. Money that leaves and
 * arrives in the same place has not moved.
 */
export class SameAccountTransferError extends DomainError {
  constructor(
    readonly transactionCode: string,
    readonly accountId: number,
  ) {
    super(
      'SameAccountTransferError',
      `Transaction '${transactionCode}' sends from account ${accountId} to itself.`,
    );
  }
}

/**
 * A rate recorded on a move that does not change currency. A rate between a
 * currency and itself is either 1 or a mistake, and storing it invites the
 * second reading.
 */
export class RateOnSameCurrencyError extends DomainError {
  constructor(
    readonly transactionCode: string,
    readonly currencyCode: string,
    readonly rate: bigint,
  ) {
    super(
      'RateOnSameCurrencyError',
      `Transaction '${transactionCode}' moves ${currencyCode} to ${currencyCode} but records a rate of ${rate.toString()}.`,
    );
  }
}

/** An amount that must be strictly positive but is not. */
export class NonPositiveAmountError extends DomainError {
  constructor(
    readonly subject: string,
    readonly field: string,
    readonly amount: string,
  ) {
    super(
      'NonPositiveAmountError',
      `${subject} has a ${field} of ${amount}; amounts must be greater than zero.`,
    );
  }
}

/** A currency an account is not permitted to hold. */
export class CurrencyNotAllowedError extends DomainError {
  constructor(
    readonly accountId: number,
    readonly accountCode: string,
    readonly currencyCode: string,
    readonly allowed: readonly string[],
  ) {
    super(
      'CurrencyNotAllowedError',
      `Account '${accountCode}' cannot hold ${currencyCode}; it is limited to ${allowed.join(', ')}.`,
    );
  }
}

/** A child transaction whose parent belongs to a different payout. */
export class ParentPayoutMismatchError extends DomainError {
  constructor(
    readonly childCode: string,
    readonly childPayoutId: number,
    readonly parentCode: string,
    readonly parentPayoutId: number,
  ) {
    super(
      'ParentPayoutMismatchError',
      `Transaction '${childCode}' belongs to payout ${childPayoutId} but its parent '${parentCode}' belongs to payout ${parentPayoutId}.`,
    );
  }
}

/** A fee schedule that cannot describe a computable fee. */
export class InvalidFeeScheduleError extends DomainError {
  constructor(
    readonly scheduleId: number,
    readonly reason: string,
  ) {
    super(
      'InvalidFeeScheduleError',
      `Fee schedule ${scheduleId} is not usable: ${reason}.`,
    );
  }
}

/**
 * A schedule whose basis is another fee that no applicable schedule produces.
 * GST is 18% of the exchange fee; with no exchange fee there is nothing to
 * take 18% of, and guessing zero would quietly under-report.
 */
export class UnresolvableFeeBasisError extends DomainError {
  constructor(
    readonly scheduleId: number,
    readonly feeType: string,
    readonly requires: string,
  ) {
    super(
      'UnresolvableFeeBasisError',
      `Fee schedule ${scheduleId} computes '${feeType}' from '${requires}', but no applicable schedule produces a '${requires}'.`,
    );
  }
}

/**
 * Two schedules for the same account and fee type applying on the same date.
 * The database has no constraint preventing overlapping effective periods, so
 * the ambiguity has to be caught here rather than silently resolved.
 */
export class AmbiguousFeeScheduleError extends DomainError {
  constructor(
    readonly accountId: number,
    readonly feeType: string,
    readonly scheduleIds: readonly number[],
  ) {
    super(
      'AmbiguousFeeScheduleError',
      `Account ${accountId} has ${scheduleIds.length} overlapping '${feeType}' schedules (${scheduleIds.join(', ')}) in effect at once.`,
    );
  }
}

/** A payout that was looked up and does not exist. */
export class PayoutNotFoundError extends DomainError {
  constructor(readonly payoutId: number) {
    super('PayoutNotFoundError', `No payout with id ${payoutId}.`);
  }
}

/** A company that was looked up and does not exist. */
export class CompanyNotFoundError extends DomainError {
  constructor(readonly companyId: number) {
    super('CompanyNotFoundError', `No company with id ${companyId}.`);
  }
}

/** An account that was looked up and does not exist. */
export class AccountNotFoundError extends DomainError {
  constructor(readonly accountId: number) {
    super('AccountNotFoundError', `No account with id ${accountId}.`);
  }
}

/** A transaction that was looked up and does not exist. */
export class TransactionNotFoundError extends DomainError {
  constructor(readonly transactionId: number) {
    super(
      'TransactionNotFoundError',
      `No transaction with id ${transactionId}.`,
    );
  }
}

/** A currency code the registry does not know. */
export class UnknownCurrencyError extends DomainError {
  constructor(readonly code: string) {
    super(
      'UnknownCurrencyError',
      `Unknown currency '${code}'. Register it with its scale before using it.`,
    );
  }
}

/** A currency definition that cannot describe a storable amount. */
export class InvalidCurrencyError extends DomainError {
  constructor(
    readonly code: string,
    readonly reason: string,
  ) {
    super(
      'InvalidCurrencyError',
      `Invalid currency definition '${code}': ${reason}.`,
    );
  }
}

/**
 * Sign-in failed. That is the whole message, deliberately.
 *
 * §5a: "One message for every sign-in failure — unknown username and wrong
 * password give identical responses." The cause is carried as a field so the
 * server can still tell them apart internally, but it is never rendered and
 * never serialised: `message` is a constant.
 */
export class AuthenticationFailedError extends DomainError {
  /** The single sentence every failed sign-in produces. */
  static readonly MESSAGE = 'Incorrect username or password.';

  /**
   * Named `failure` rather than `cause`: `Error.cause` already exists in
   * ES2022 and shadowing it with a different meaning is how a log line ends
   * up saying `wrong_password` where a stack trace belongs.
   */
  constructor(readonly failure: 'unknown_username' | 'wrong_password') {
    super('AuthenticationFailedError', AuthenticationFailedError.MESSAGE);
  }
}

/** A session that cannot be used: never existed, expired, or was revoked. */
export class SessionInvalidError extends DomainError {
  constructor(readonly reason: 'unknown' | 'expired' | 'revoked') {
    super('SessionInvalidError', `Session is not valid: ${reason}.`);
  }
}

/**
 * A candidate password that broke the policy.
 *
 * Carries the violation codes, not prose, so the UI decides the wording and a
 * test asserts on a stable value. The candidate itself is never included —
 * N9 puts a password out of reach of an error message.
 */
export class PasswordPolicyError extends DomainError {
  constructor(readonly violations: readonly string[]) {
    super(
      'PasswordPolicyError',
      `Password rejected by policy: ${violations.join(', ')}.`,
    );
  }
}

/** A username that already belongs to somebody. */
export class UsernameTakenError extends DomainError {
  constructor(readonly username: string) {
    super('UsernameTakenError', `Username '${username}' is already in use.`);
  }
}

/** A username that is not a username. */
export class InvalidUsernameError extends DomainError {
  constructor(
    readonly username: string,
    readonly reason: string,
  ) {
    super('InvalidUsernameError', `Invalid username: ${reason}.`);
  }
}

/** A user that was looked up and does not exist. */
export class UserNotFoundError extends DomainError {
  constructor(readonly userId: number) {
    super('UserNotFoundError', `No user with id ${userId}.`);
  }
}

/** A document that was looked up and does not exist. */
export class DocumentNotFoundError extends DomainError {
  constructor(readonly documentId: number) {
    super('DocumentNotFoundError', `No document with id ${documentId}.`);
  }
}

/** A company code that already belongs to another company. */
export class CompanyCodeTakenError extends DomainError {
  constructor(readonly code: string) {
    super(
      'CompanyCodeTakenError',
      `A company with code '${code}' already exists.`,
    );
  }
}

/** An account code that already belongs to another account. */
export class AccountCodeTakenError extends DomainError {
  constructor(readonly code: string) {
    super(
      'AccountCodeTakenError',
      `An account with code '${code}' already exists.`,
    );
  }
}

/**
 * An account that still has money moving through it.
 *
 * `transactions.from_account_id` and `to_account_id` are ON DELETE RESTRICT,
 * so the database already refuses this — but "FOREIGN KEY constraint failed"
 * is not a sentence anybody can act on, and the action here is a real one:
 * delete the payouts whose legs use the account, or leave the account alone.
 * §7's "unless the message needs to be friendlier", in other words.
 */
export class AccountInUseError extends DomainError {
  constructor(
    readonly code: string,
    readonly transactionCount: number,
  ) {
    super(
      'AccountInUseError',
      `Account '${code}' is used by ${transactionCount} transaction${transactionCount === 1 ? '' : 's'} and cannot be deleted. Delete those payouts first, or keep the account.`,
    );
  }
}

/** A document whose bytes are missing from the store. */
export class DocumentFileMissingError extends DomainError {
  constructor(
    readonly documentId: number,
    readonly storedPath: string,
  ) {
    super(
      'DocumentFileMissingError',
      `Document ${documentId} refers to '${storedPath}', which is not in the file store.`,
    );
  }
}
