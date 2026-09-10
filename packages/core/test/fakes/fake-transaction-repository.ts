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

  allFees(): readonly TransactionFee[] {
    return [...this.#fees.values()];
  }

  all(): readonly Transaction[] {
    return [...this.#rows.values()];
  }
}
