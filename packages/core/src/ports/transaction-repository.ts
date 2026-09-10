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

  insert(draft: TransactionDraft): Promise<Transaction>;

  update(transaction: Transaction): Promise<Transaction>;

  listFeesByPayout(payoutId: PayoutId): Promise<readonly TransactionFee[]>;

  listFeesByTransaction(
    transactionId: TransactionId,
  ): Promise<readonly TransactionFee[]>;

  /** One fee per type per transaction; re-recording a type replaces it. */
  recordFee(draft: TransactionFeeDraft): Promise<TransactionFee>;
}
