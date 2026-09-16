import type { PayoutId, TransactionId } from '../../src/domain/ids';
import { Transaction } from '../../src/domain/transaction';
import { TransactionFee } from '../../src/domain/transaction-fee';
import type {
  TransactionDraft,
  TransactionFeeDraft,
  TransactionRepository,
} from '../../src/ports/transaction-repository';

export class FakeTransactionRepository implements TransactionRepository {
  readonly #rows = new Map<TransactionId, Transaction>();
  readonly #fees = new Map<number, TransactionFee>();
  #nextId = 1;
  #nextFeeId = 1;

  seed(...transactions: readonly Transaction[]): this {
    for (const transaction of transactions) {
      this.#rows.set(transaction.id, transaction);
      this.#nextId = Math.max(this.#nextId, transaction.id + 1);
    }
    return this;
  }

  seedFees(...fees: readonly TransactionFee[]): this {
    for (const fee of fees) {
      this.#fees.set(fee.id, fee);
      this.#nextFeeId = Math.max(this.#nextFeeId, fee.id + 1);
    }
    return this;
  }

  findById(id: TransactionId): Promise<Transaction | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByCode(code: string): Promise<Transaction | null> {
    for (const transaction of this.#rows.values()) {
      if (transaction.code === code) {
        return Promise.resolve(transaction);
      }
    }
    return Promise.resolve(null);
  }

  listByPayout(payoutId: PayoutId): Promise<readonly Transaction[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (transaction) => transaction.payoutId === payoutId,
      ),
    );
  }

  listChildren(parentId: TransactionId): Promise<readonly Transaction[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (transaction) => transaction.parentId === parentId,
      ),
    );
  }

  list(): Promise<readonly Transaction[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  listFees(): Promise<readonly TransactionFee[]> {
    return Promise.resolve([...this.#fees.values()]);
  }

  /**
   * Construction is where the entity's own invariants are checked, so a
   * draft that would break one never reaches the map.
   */
  insert(draft: TransactionDraft): Promise<Transaction> {
    const transaction = Transaction.record({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(transaction.id, transaction);
    return Promise.resolve(transaction);
  }

  update(transaction: Transaction): Promise<Transaction> {
    this.#rows.set(transaction.id, transaction);
    return Promise.resolve(transaction);
  }

  listFeesByPayout(payoutId: PayoutId): Promise<readonly TransactionFee[]> {
    const legIds = new Set(
      [...this.#rows.values()]
        .filter((transaction) => transaction.payoutId === payoutId)
        .map((transaction) => transaction.id),
    );

    return Promise.resolve(
      [...this.#fees.values()].filter((fee) => legIds.has(fee.transactionId)),
    );
  }

  listFeesByTransaction(
    transactionId: TransactionId,
  ): Promise<readonly TransactionFee[]> {
    return Promise.resolve(
      [...this.#fees.values()].filter(
        (fee) => fee.transactionId === transactionId,
      ),
    );
  }

  /** One fee per type per transaction: re-recording a type replaces it. */
  recordFee(draft: TransactionFeeDraft): Promise<TransactionFee> {
    const existing = [...this.#fees.values()].find(
      (fee) =>
        fee.transactionId === draft.transactionId &&
        fee.feeType === draft.feeType,
    );

    const id = existing?.id ?? this.#nextFeeId;
    if (existing === undefined) {
      this.#nextFeeId += 1;
    }

    const fee = TransactionFee.record({ ...draft, id });
    this.#fees.set(id, fee);
    return Promise.resolve(fee);
  }

  /**
   * A leg and every leg below it, as `SqliteTransactionRepository.delete` does
   * it — the subtree, because a child is money that arrived from this leg.
   */
  delete(id: TransactionId): Promise<void> {
    const doomed = new Set<TransactionId>([id]);

    // Repeated passes rather than a walk: the rows are a Map in no particular
    // order, so a single pass could meet a grandchild before its parent had
    // been marked. Bounded by the depth of the tree.
    for (;;) {
      const before = doomed.size;

      for (const transaction of this.#rows.values()) {
        if (transaction.parentId !== null && doomed.has(transaction.parentId)) {
          doomed.add(transaction.id);
        }
      }

      if (doomed.size === before) break;
    }

    for (const transactionId of doomed) {
      this.#rows.delete(transactionId);

      for (const fee of [...this.#fees.values()]) {
        if (fee.transactionId === transactionId) {
          this.#fees.delete(fee.id);
        }
      }
    }

    return Promise.resolve();
  }

  /**
   * The cascade `PayoutRepository.delete` performs in SQL, in a Map.
   *
   * Not on the port: no use case deletes a leg on its own, and a port method
   * with no caller is exactly what §5 says a port is not. It exists so that
   * `FakePayoutRepository` can take the legs with it, and a use-case test can
   * assert the world afterwards rather than trusting a comment.
   */
  deleteByPayout(payoutId: PayoutId): number {
    const doomed = [...this.#rows.values()].filter(
      (transaction) => transaction.payoutId === payoutId,
    );

    for (const transaction of doomed) {
      this.#rows.delete(transaction.id);

      for (const fee of [...this.#fees.values()]) {
        if (fee.transactionId === transaction.id) {
          this.#fees.delete(fee.id);
        }
      }
    }

    return doomed.length;
  }

  allFees(): readonly TransactionFee[] {
    return [...this.#fees.values()];
  }

  all(): readonly Transaction[] {
    return [...this.#rows.values()];
  }
}
