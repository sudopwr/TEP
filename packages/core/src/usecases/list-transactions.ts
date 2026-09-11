import type { PayoutId } from '../domain/ids';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface ListTransactionsDependencies {
  readonly transactions: TransactionRepository;
}

export interface ListTransactionsCommand {
  readonly payoutId?: PayoutId;
}

/**
 * F3's flat read side.
 *
 * Deliberately flat: the *tree* is UC5's job, and it costs a fees lookup and
 * a documents lookup per node. A list view that only needs rows should not
 * pay for that.
 */
export class ListTransactions {
  readonly #deps: ListTransactionsDependencies;

  constructor(dependencies: ListTransactionsDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: ListTransactionsCommand = {},
  ): Promise<readonly Transaction[]> {
    const { transactions } = this.#deps;

    return command.payoutId === undefined
      ? transactions.list()
      : transactions.listByPayout(command.payoutId);
  }
}
