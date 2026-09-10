import type { CurrencyRegistry } from '../domain/currency';
import { expectedFees } from '../domain/fee-engine';
import type {
  AccountId,
  IsoDate,
  PayoutId,
  TransactionId,
} from '../domain/ids';
import { Money, type RoundingMode } from '../domain/money';
import type { Transaction } from '../domain/transaction';
import type { TransactionFee } from '../domain/transaction-fee';
import type { FeeScheduleRepository } from '../ports/fee-schedule-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

import type { RecordTransaction } from './record-transaction';

export interface RecordSaleDependencies {
  readonly recordTransaction: RecordTransaction;
  readonly transactions: TransactionRepository;
  readonly feeSchedules: FeeScheduleRepository;
  readonly currencies: CurrencyRegistry;
}

export interface RecordSaleCommand {
  readonly code: string;
  readonly payoutId: PayoutId;
  readonly parentId: TransactionId | null;
  readonly txnDate: IsoDate;
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  /** The crypto amount sold, as a decimal string. */
  readonly fromAmount: string;
  readonly fromCurrencyCode: string;
  /** Scaled by 1e8, matching `transactions.rate_applied`. */
  readonly rate: bigint;
  readonly settlementCurrencyCode: string;
  /** Statutory, taken from the statement rather than computed. */
  readonly tds?: string | null;
  readonly rounding?: RoundingMode;
  readonly notes?: string | null;
}

export interface SaleRecorded {
  readonly transaction: Transaction;
  readonly grossProceeds: Money;
  readonly fees: readonly TransactionFee[];
  readonly totalFees: Money;
  readonly netCredited: Money;
}

/**
 * UC3 — the exchange leg, where the 0.5% and 18% rules land.
 *
 * Gross proceeds are computed from the amount and the rate and recorded as
 * the transaction's to-amount, matching the exchange statement (§13). The
 * exchange fee and GST are then derived from the declared schedule rather
 * than accepted from the caller; TDS is the exception, because it is a
 * statutory figure that appears on the statement and follows no schedule.
 */
export class RecordSale {
  readonly #deps: RecordSaleDependencies;

  constructor(dependencies: RecordSaleDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordSaleCommand): Promise<SaleRecorded> {
    const { recordTransaction, transactions, feeSchedules, currencies } =
      this.#deps;

    const rounding = command.rounding ?? 'half-up';
    const fromCurrency = currencies.get(command.fromCurrencyCode);
    const settlementCurrency = currencies.get(command.settlementCurrencyCode);

    const grossProceeds = Money.fromDecimalString(
      command.fromAmount,
      fromCurrency,
    ).multiplyByRate(command.rate, settlementCurrency, rounding);

    const transaction = await recordTransaction.execute({
      code: command.code,
      payoutId: command.payoutId,
      parentId: command.parentId,
      txnDate: command.txnDate,
      kind: 'sale',
      fromAccountId: command.fromAccountId,
      toAccountId: command.toAccountId,
      fromAmount: command.fromAmount,
      fromCurrencyCode: command.fromCurrencyCode,
      toAmount: grossProceeds.toDecimalString(),
      toCurrencyCode: command.settlementCurrencyCode,
      rate: command.rate,
      notes: command.notes ?? null,
    });

    const schedules = await feeSchedules.listForAccountOn(
      command.fromAccountId,
      command.txnDate,
    );

    const fees: TransactionFee[] = [];

    for (const expected of expectedFees(transaction, schedules, { rounding })) {
      fees.push(
        await transactions.recordFee({
          transactionId: transaction.id,
          feeType: expected.feeType,
          amount: expected.amount,
        }),
      );
    }

    if (command.tds !== undefined && command.tds !== null) {
      fees.push(
        await transactions.recordFee({
          transactionId: transaction.id,
          feeType: 'tds',
          amount: Money.fromDecimalString(command.tds, settlementCurrency),
        }),
      );
    }

    const totalFees = fees
      .filter((fee) => fee.isDenominatedIn(settlementCurrency))
      .reduce(
        (total, fee) => total.add(fee.amount),
        Money.zero(settlementCurrency),
      );

    return {
      transaction,
      grossProceeds,
      fees,
      totalFees,
      netCredited: grossProceeds.subtract(totalFees),
    };
  }
}
