import type { PayoutId, TransactionId } from '../domain/ids';
import type { Transaction, TransactionProps } from '../domain/transaction';
import type {
  TransactionFee,
  TransactionFeeProps,
} from '../domain/transaction-fee';

export type TransactionDraft = Omit<TransactionProps, 'id'>;
export type TransactionFeeDraft = Omit<TransactionFeeProps, 'id'>;

/**
 * Transactions and their fees.
 *
 * Fees live here rather than in a repository of their own: a fee has no
 * meaning apart from its transaction, is never queried without it, and is
 * written in the same unit of work. Splitting them would create a port with
 * one caller, which §5 says is not a port.
 */
export interface TransactionRepository {
  findById(id: TransactionId): Promise<Transaction | null>;

  findByCode(code: string): Promise<Transaction | null>;

  /** Every leg of a payout, in no guaranteed order — the tree is built from
   *  `parentId`, not from the order rows come back in. */
  listByPayout(payoutId: PayoutId): Promise<readonly Transaction[]>;

  listChildren(parentId: TransactionId): Promise<readonly Transaction[]>;

  /** Every leg, across every payout. Balances are ledger-wide (F10). */
  list(): Promise<readonly Transaction[]>;

  insert(draft: TransactionDraft): Promise<Transaction>;

  update(transaction: Transaction): Promise<Transaction>;

  listFees(): Promise<readonly TransactionFee[]>;

  listFeesByPayout(payoutId: PayoutId): Promise<readonly TransactionFee[]>;

  listFeesByTransaction(
    transactionId: TransactionId,
  ): Promise<readonly TransactionFee[]>;

  /** One fee per type per transaction; re-recording a type replaces it. */
  recordFee(draft: TransactionFeeDraft): Promise<TransactionFee>;

  /**
   * Remove a leg and every leg below it, all or nothing.
   *
   * The subtree and not just the row: a child describes money that arrived
   * *from* this leg, and leaving it behind would manufacture the broken link
   * `GetPayoutTrail` renders as an orphaned root. That rendering exists to
   * make damage visible, not to be a place to put legs on purpose.
   *
   * Their fees go too, and the document links to any of them — never the
   * documents, which may be evidence for several things (F6).
   */
  delete(id: TransactionId): Promise<void>;
}
