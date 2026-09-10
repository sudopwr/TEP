import type { Account } from '../domain/account';
import { compareToActual, expectedFees } from '../domain/fee-engine';
import type { AccountId, PayoutId, TransactionId } from '../domain/ids';
import { Money } from '../domain/money';
import type { Transaction } from '../domain/transaction';
import type { TransactionFee } from '../domain/transaction-fee';
import type { AccountRepository } from '../ports/account-repository';
import type { FeeScheduleRepository } from '../ports/fee-schedule-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface RunDataQualityChecksDependencies {
  readonly payouts: PayoutRepository;
  readonly transactions: TransactionRepository;
  readonly accounts: AccountRepository;
  readonly feeSchedules: FeeScheduleRepository;
}

export interface RunDataQualityChecksCommand {
  /** Omit to sweep everything. */
  readonly payoutId?: PayoutId;
  /** How far a fee may sit from its schedule. §7 says 2%. */
  readonly feeTolerancePct?: number;
}

export type DataQualityCheck =
  | 'missing_rate'
  | 'exceeds_parent'
  | 'unreconciled_amount'
  | 'fee_off_schedule'
  | 'currency_not_allowed'
  | 'no_bank_leg';

export interface DataQualityIssue {
  readonly subject: string;
  readonly subjectKind: 'transaction' | 'payout';
  readonly check: DataQualityCheck;
  readonly detail: string;
}

/**
 * A hundredth of a major unit, matching the tolerance `v_data_quality` uses:
 * one paisa for rupees, 0.01 USDT for USDT.
 */
function reconciliationTolerance(amount: Money): Money {
  const unit = 10n ** BigInt(amount.currency.scale) / 100n;
  return Money.fromMinor(unit === 0n ? 1n : unit, amount.currency);
}

/**
 * UC8 — the suspicious-but-legal sweep.
 *
 * These are the states CLAUDE.md §7 deliberately leaves out of the database
 * constraints because they are questionable rather than impossible: a sale
 * that draws on balance an earlier transfer left behind is entirely normal,
 * and blocking it at entry would be wrong. Surfacing it is not.
 */
export class RunDataQualityChecks {
  readonly #deps: RunDataQualityChecksDependencies;

  constructor(dependencies: RunDataQualityChecksDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: RunDataQualityChecksCommand = {},
  ): Promise<readonly DataQualityIssue[]> {
    const { payouts, transactions, accounts } = this.#deps;
    const tolerancePct = command.feeTolerancePct ?? 2;

    const legs =
      command.payoutId === undefined
        ? await transactions.list()
        : await transactions.listByPayout(command.payoutId);
    const fees =
      command.payoutId === undefined
        ? await transactions.listFees()
        : await transactions.listFeesByPayout(command.payoutId);

    const legById = new Map(legs.map((leg) => [leg.id, leg]));
    const feesByLeg = new Map<TransactionId, TransactionFee[]>();
    for (const fee of fees) {
      const bucket = feesByLeg.get(fee.transactionId) ?? [];
      bucket.push(fee);
      feesByLeg.set(fee.transactionId, bucket);
    }

    const directory = new Map<AccountId, Account>(
      (await accounts.list()).map((account) => [account.id, account]),
    );

    const issues: DataQualityIssue[] = [];

    for (const leg of legs) {
      const legFees = feesByLeg.get(leg.id) ?? [];

      this.#checkRate(leg, issues);
      this.#checkParent(leg, legById, issues);
      this.#checkReconciliation(leg, legFees, issues);
      this.#checkCurrencies(leg, directory, issues);
      await this.#checkFees(leg, legFees, tolerancePct, issues);
    }

    const candidates =
      command.payoutId === undefined
        ? await payouts.list()
        : await payouts
            .findById(command.payoutId)
            .then((one) => (one === null ? [] : [one]));

    for (const payout of candidates) {
      const ownLegs = legs.filter((leg) => leg.payoutId === payout.id);
      const reachedBank = ownLegs.some(
        (leg) => directory.get(leg.toAccountId)?.isBank() === true,
      );

      if (!reachedBank) {
        issues.push({
          subject: payout.code,
          subjectKind: 'payout',
          check: 'no_bank_leg',
          detail: 'no transaction in this payout reaches a bank account',
        });
      }
    }

    return issues;
  }

  #checkRate(leg: Transaction, issues: DataQualityIssue[]): void {
    if (
      leg.fromAmount.currency.code !== leg.toAmount.currency.code &&
      leg.rate === null
    ) {
      issues.push({
        subject: leg.code,
        subjectKind: 'transaction',
        check: 'missing_rate',
        detail: `${leg.fromAmount.currency.code} to ${leg.toAmount.currency.code} with no rate recorded`,
      });
    }
  }

  #checkParent(
    leg: Transaction,
    legById: ReadonlyMap<TransactionId, Transaction>,
    issues: DataQualityIssue[],
  ): void {
    if (leg.parentId === null) {
      return;
    }

    const parent = legById.get(leg.parentId);
    if (parent === undefined) {
      return;
    }
    if (parent.toAmount.currency.code !== leg.fromAmount.currency.code) {
      return;
    }
    if (leg.fromAmount.compare(parent.toAmount) <= 0) {
      return;
    }

    issues.push({
      subject: leg.code,
      subjectKind: 'transaction',
      check: 'exceeds_parent',
      detail: `sends ${leg.fromAmount.toString()} but '${parent.code}' delivered only ${parent.toAmount.toString()} — legitimate if earlier dust was still in the account`,
    });
  }

  #checkReconciliation(
    leg: Transaction,
    legFees: readonly TransactionFee[],
    issues: DataQualityIssue[],
  ): void {
    if (leg.rate === null) {
      return;
    }

    const sourceFees = legFees
      .filter((fee) => fee.isDenominatedIn(leg.fromAmount.currency))
      .reduce(
        (total, fee) => total.add(fee.amount),
        Money.zero(leg.fromAmount.currency),
      );

    const expected = leg.fromAmount
      .subtract(sourceFees)
      .multiplyByRate(leg.rate, leg.toAmount.currency, 'half-up');

    const drift = leg.toAmount.subtract(expected).abs();

    if (drift.compare(reconciliationTolerance(leg.toAmount)) > 0) {
      issues.push({
        subject: leg.code,
        subjectKind: 'transaction',
        check: 'unreconciled_amount',
        detail: `recorded ${leg.toAmount.toString()} but rate and fees imply ${expected.toString()}`,
      });
    }
  }

  #checkCurrencies(
    leg: Transaction,
    directory: ReadonlyMap<AccountId, Account>,
    issues: DataQualityIssue[],
  ): void {
    const sides = [
      { account: directory.get(leg.fromAccountId), money: leg.fromAmount },
      { account: directory.get(leg.toAccountId), money: leg.toAmount },
    ];

    for (const { account, money } of sides) {
      if (account === undefined || account.allows(money.currency.code)) {
        continue;
      }
      issues.push({
        subject: leg.code,
        subjectKind: 'transaction',
        check: 'currency_not_allowed',
        detail: `${money.currency.code} moved through '${account.code}', which is limited to ${account.allowedCurrencies.join(', ')}`,
      });
    }
  }

  async #checkFees(
    leg: Transaction,
    legFees: readonly TransactionFee[],
    tolerancePct: number,
    issues: DataQualityIssue[],
  ): Promise<void> {
    const schedules = await this.#deps.feeSchedules.listForAccountOn(
      leg.fromAccountId,
      leg.txnDate,
    );

    if (schedules.length === 0) {
      return;
    }

    for (const discrepancy of compareToActual(
      expectedFees(leg, schedules),
      legFees,
      tolerancePct,
    )) {
      issues.push({
        subject: leg.code,
        subjectKind: 'transaction',
        check: 'fee_off_schedule',
        detail: `${discrepancy.feeType}: ${discrepancy.reason}, schedule says ${discrepancy.expected.toString()}, recorded ${discrepancy.actual?.toString() ?? 'nothing'}`,
      });
    }
  }
}
