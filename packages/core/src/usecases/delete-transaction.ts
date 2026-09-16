import { TransactionNotFoundError } from '../domain/errors';
import type { PayoutId, TransactionId } from '../domain/ids';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface DeleteTransactionDependencies {
  readonly transactions: TransactionRepository;
}

export interface DeleteTransactionCommand {
  readonly transactionId: TransactionId;
}

/**
 * What went, so the caller can say it before doing it and after.
 *
 * `payoutId` is here because everything derived from this leg belongs to that
 * payout — the trail, the settlement, the checks — and the caller has to know
 * which one to re-read. The leg itself is the row as it was; there is nothing
 * on file with that id by the time this is read.
 */
export interface TransactionDeleted {
  readonly transaction: Transaction;
  readonly payoutId: PayoutId;
  /** Includes the leg itself, so 1 means it had nothing below it. */
  readonly transactionsDeleted: number;
  readonly feesDeleted: number;
}

/**
 * Delete a leg, and every leg below it.
 *
 * **Why the subtree, rather than refusing a leg that has children.** A child
 * leg is money that arrived *from* this one: a withdrawal's transfer, a
 * transfer's sale. Deleting the parent alone would leave those legs pointing
 * at a `parent_id` that no longer exists — which `GetPayoutTrail` renders as
 * an orphaned root on purpose, to make a broken link visible, and which
 * nothing should create deliberately. `transactions.parent_id` is ON DELETE
 * RESTRICT, so the alternative is refusing, and refusing would mean unpicking
 * §10's four-level tree one confirmation at a time.
 *
 * The cost of that choice is that one click can remove six legs, so this
 * counts them *before* the delete and hands the number back — the
 * confirmation in front of the reader says "and the 3 legs below it" because
 * this told it so.
 *
 * **Not the payout.** Deleting the last leg leaves the payout standing with
 * no movements, which is exactly the state it is recorded in before the first
 * one. §13's status is derived, so it simply reads as open again.
 */
export class DeleteTransaction {
  readonly #deps: DeleteTransactionDependencies;

  constructor(dependencies: DeleteTransactionDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: DeleteTransactionCommand,
  ): Promise<TransactionDeleted> {
    const { transactions } = this.#deps;

    const transaction = await transactions.findById(command.transactionId);
    if (transaction === null) {
      throw new TransactionNotFoundError(command.transactionId);
    }

    const legs = await transactions.listByPayout(transaction.payoutId);
    const doomed = descendants(legs, transaction.id);

    const fees = await transactions.listFeesByPayout(transaction.payoutId);
    const feesDeleted = fees.filter((fee) =>
      doomed.has(fee.transactionId),
    ).length;

    await transactions.delete(transaction.id);

    return {
      transaction,
      payoutId: transaction.payoutId,
      transactionsDeleted: doomed.size,
      feesDeleted,
    };
  }
}

/**
 * The leg and everything under it, by walking `parentId` outward.
 *
 * Iterative rather than recursive, and it never revisits an id: a cycle in
 * `parent_id` is impossible by CHECK for the one-step case and unlikely for
 * longer ones, but "unlikely" is not a reason to write a loop that would hang
 * if it happened.
 */
function descendants(
  legs: readonly Transaction[],
  root: TransactionId,
): ReadonlySet<TransactionId> {
  const childrenOf = new Map<TransactionId, TransactionId[]>();

  for (const leg of legs) {
    if (leg.parentId === null) continue;

    const bucket = childrenOf.get(leg.parentId) ?? [];
    bucket.push(leg.id);
    childrenOf.set(leg.parentId, bucket);
  }

  const found = new Set<TransactionId>([root]);
  const queue: TransactionId[] = [root];

  while (queue.length > 0) {
    const next = queue.shift() as TransactionId;

    for (const child of childrenOf.get(next) ?? []) {
      if (found.has(child)) continue;

      found.add(child);
      queue.push(child);
    }
  }

  return found;
}
