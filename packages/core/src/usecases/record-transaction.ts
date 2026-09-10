import type { Account } from '../domain/account';
import type { CurrencyRegistry } from '../domain/currency';
import {
  AccountNotFoundError,
  ParentPayoutMismatchError,
  PayoutNotFoundError,
  TransactionNotFoundError,
} from '../domain/errors';
import type {
  AccountId,
  IsoDate,
  PayoutId,
  TransactionId,
} from '../domain/ids';
import { Money } from '../domain/money';
import type { Transaction, TransactionKind } from '../domain/transaction';
import type { AccountRepository } from '../ports/account-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface RecordTransactionDependencies {
  readonly transactions: TransactionRepository;
  readonly payouts: PayoutRepository;
  readonly accounts: AccountRepository;
  readonly currencies: CurrencyRegistry;
}

export interface RecordTransactionCommand {
  readonly code: string;
  readonly payoutId: PayoutId;
  readonly parentId: TransactionId | null;
  readonly txnDate: IsoDate;
  readonly kind: TransactionKind;
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  readonly fromAmount: string;
  readonly fromCurrencyCode: string;
  readonly toAmount: string;
  readonly toCurrencyCode: string;
  readonly rate: bigint | null;
  readonly notes?: string | null;
}

/**
 * UC2 — record one movement between two accounts.
 *
 * The checks here are the ones that need more than the transaction itself:
 * that the payout and accounts exist, that a parent belongs to the same
 * payout, and that both accounts are permitted to hold the currencies moving
 * through them. The invariants that need only the row — same account on both
 * sides, a rate on a same-currency move, non-positive amounts — belong to the
 * entity and fire when it is constructed.
 */
export class RecordTransaction {
  readonly #deps: RecordTransactionDependencies;

  constructor(dependencies: RecordTransactionDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordTransactionCommand): Promise<Transaction> {
    const { transactions, payouts, currencies } = this.#deps;

    const payout = await payouts.findById(command.payoutId);
    if (payout === null) {
      throw new PayoutNotFoundError(command.payoutId);
    }

    const fromAccount = await this.#requireAccount(command.fromAccountId);
    const toAccount = await this.#requireAccount(command.toAccountId);

    const fromCurrency = currencies.get(command.fromCurrencyCode);
    const toCurrency = currencies.get(command.toCurrencyCode);

    // An account can no more send a currency it cannot hold than receive one.
    fromAccount.assertCanHold(fromCurrency);
    toAccount.assertCanHold(toCurrency);

    if (command.parentId !== null) {
      const parent = await transactions.findById(command.parentId);
      if (parent === null) {
        throw new TransactionNotFoundError(command.parentId);
      }
      if (parent.payoutId !== command.payoutId) {
        throw new ParentPayoutMismatchError(
          command.code,
          command.payoutId,
          parent.code,
          parent.payoutId,
        );
      }
    }

    return transactions.insert({
      code: command.code,
      payoutId: command.payoutId,
      parentId: command.parentId,
      txnDate: command.txnDate,
      kind: command.kind,
      fromAccountId: command.fromAccountId,
      toAccountId: command.toAccountId,
      fromAmount: Money.fromDecimalString(command.fromAmount, fromCurrency),
      toAmount: Money.fromDecimalString(command.toAmount, toCurrency),
      rate: command.rate,
      notes: command.notes ?? null,
    });
  }

  async #requireAccount(id: AccountId): Promise<Account> {
    const account = await this.#deps.accounts.findById(id);
    if (account === null) {
      throw new AccountNotFoundError(id);
    }
    return account;
  }
}
