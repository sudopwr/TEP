import {
  AmbiguousFeeScheduleError,
  InvalidFeeScheduleError,
  UnresolvableFeeBasisError,
} from './errors';
import type { FeeBasis, FeeSchedule } from './fee-schedule';
import type { AccountId, FeeScheduleId } from './ids';
import type { Money, RoundingMode } from './money';
import type { Transaction } from './transaction';
import type { FeeType, TransactionFee } from './transaction-fee';

/** A fee the declared schedules say *should* be on a transaction. */
export interface ExpectedFee {
  readonly feeType: FeeType;
  readonly amount: Money;
  readonly basis: FeeBasis;
  readonly scheduleId: FeeScheduleId;
}

export interface FeeEngineOptions {
  readonly rounding?: RoundingMode;
}

export type DiscrepancyReason =
  'amount_off_schedule' | 'missing' | 'currency_mismatch';

export interface FeeDiscrepancy {
  readonly feeType: FeeType;
  readonly reason: DiscrepancyReason;
  readonly expected: Money;
  /** Null when nothing was recorded at all. */
  readonly actual: Money | null;
  /** `actual - expected`. Null when there is no comparable actual. */
  readonly difference: Money | null;
  readonly toleranceBps: number;
}

/**
 * The one basis that names another fee instead of a side of the transaction.
 * Adding a second entry here is all it takes to support, say, a cess on GST.
 */
const DERIVED_BASES: ReadonlyMap<FeeBasis, FeeType> = new Map([
  ['exchange_fee', 'exchange_fee' as FeeType],
]);

function requireRate(schedule: FeeSchedule): number {
  const { rateBps } = schedule;
  if (rateBps === null) {
    throw new InvalidFeeScheduleError(
      schedule.id,
      `a '${schedule.basis}' basis needs a rate in basis points`,
    );
  }
  return rateBps;
}

function requireFlatAmount(schedule: FeeSchedule): Money {
  const { flatAmount } = schedule;
  if (flatAmount === null) {
    throw new InvalidFeeScheduleError(
      schedule.id,
      'a flat basis needs a flat amount',
    );
  }
  return flatAmount;
}

/** Bases that can be resolved from the transaction alone, in one pass. */
function computeDirect(
  transaction: Transaction,
  schedule: FeeSchedule,
  rounding: RoundingMode,
): Money {
  switch (schedule.basis) {
    case 'to_amount':
      return transaction.toAmount.percentage(requireRate(schedule), rounding);
    case 'from_amount':
      return transaction.fromAmount.percentage(requireRate(schedule), rounding);
    case 'flat':
      return requireFlatAmount(schedule);
    default:
      throw new InvalidFeeScheduleError(
        schedule.id,
        `basis '${schedule.basis}' is derived from another fee and cannot be computed directly`,
      );
  }
}

/**
 * The database has no unique constraint on (account, fee_type, period), so
 * two schedules can be in force at once. Picking one silently is exactly the
 * kind of quiet wrong answer this application exists to prevent.
 */
function assertUnambiguous(
  accountId: AccountId,
  schedules: readonly FeeSchedule[],
): void {
  const byType = new Map<FeeType, FeeScheduleId[]>();

  for (const schedule of schedules) {
    const seen = byType.get(schedule.feeType) ?? [];
    seen.push(schedule.id);
    byType.set(schedule.feeType, seen);
  }

  for (const [feeType, ids] of byType) {
    if (ids.length > 1) {
      throw new AmbiguousFeeScheduleError(accountId, feeType, ids);
    }
  }
}

/**
 * What the declared schedules say this transaction's fees should be.
 *
 * Schedules are filtered to the paying side — the from-account — and to those
 * in force on the transaction's date, then resolved in dependency order:
 * everything computable from the transaction first, then anything computed
 * from one of those. GST is 18% of the exchange fee, so it cannot be produced
 * until the exchange fee has been, whatever order the schedules arrive in.
 *
 * An account with no applicable schedule has no expected fees. That is an
 * answer, not a failure — TDS has no schedule at all and never will.
 */
export function expectedFees(
  transaction: Transaction,
  schedules: readonly FeeSchedule[],
  options: FeeEngineOptions = {},
): readonly ExpectedFee[] {
  const rounding = options.rounding ?? 'half-up';

  const applicable = schedules.filter(
    (schedule) =>
      schedule.accountId === transaction.fromAccountId &&
      schedule.appliesOn(transaction.txnDate),
  );

  assertUnambiguous(transaction.fromAccountId, applicable);

  const derived = applicable.filter((schedule) =>
    DERIVED_BASES.has(schedule.basis),
  );

  const resolved: ExpectedFee[] = applicable
    .filter((schedule) => !DERIVED_BASES.has(schedule.basis))
    .map((schedule) => ({
      feeType: schedule.feeType,
      amount: computeDirect(transaction, schedule, rounding),
      basis: schedule.basis,
      scheduleId: schedule.id,
    }));

  const amountsByType = new Map<FeeType, Money>(
    resolved.map((fee) => [fee.feeType, fee.amount]),
  );

  for (const schedule of derived) {
    const requires = DERIVED_BASES.get(schedule.basis);
    const base =
      requires === undefined ? undefined : amountsByType.get(requires);

    if (requires === undefined || base === undefined) {
      throw new UnresolvableFeeBasisError(
        schedule.id,
        schedule.feeType,
        requires ?? schedule.basis,
      );
    }

    resolved.push({
      feeType: schedule.feeType,
      amount: base.percentage(requireRate(schedule), rounding),
      basis: schedule.basis,
      scheduleId: schedule.id,
    });
  }

  return resolved;
}

/**
 * Compare what the schedules predicted against what was actually recorded.
 *
 * Only expected fees are examined. A recorded fee that no schedule predicts —
 * TDS, a platform charge — is not a discrepancy; flagging those would bury
 * the real ones.
 *
 * `tolerancePct` is a policy knob rather than an amount, so converting it to
 * whole basis points with `Math.round` is the only arithmetic here that is
 * not exact. Every comparison on money itself stays in integers.
 */
export function compareToActual(
  expected: readonly ExpectedFee[],
  actual: readonly TransactionFee[],
  tolerancePct: number,
): readonly FeeDiscrepancy[] {
  const toleranceBps = Math.round(tolerancePct * 100);
  const discrepancies: FeeDiscrepancy[] = [];

  for (const fee of expected) {
    const recorded = actual.find((row) => row.feeType === fee.feeType);

    if (recorded === undefined) {
      discrepancies.push({
        feeType: fee.feeType,
        reason: 'missing',
        expected: fee.amount,
        actual: null,
        difference: null,
        toleranceBps,
      });
      continue;
    }

    if (recorded.amount.currency.code !== fee.amount.currency.code) {
      discrepancies.push({
        feeType: fee.feeType,
        reason: 'currency_mismatch',
        expected: fee.amount,
        actual: recorded.amount,
        difference: null,
        toleranceBps,
      });
      continue;
    }

    const difference = recorded.amount.subtract(fee.amount);
    const allowance = fee.amount.percentage(toleranceBps, 'half-up');

    if (difference.abs().compare(allowance) > 0) {
      discrepancies.push({
        feeType: fee.feeType,
        reason: 'amount_off_schedule',
        expected: fee.amount,
        actual: recorded.amount,
        difference,
        toleranceBps,
      });
    }
  }

  return discrepancies;
}
