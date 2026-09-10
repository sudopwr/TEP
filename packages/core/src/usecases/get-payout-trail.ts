import type { Document } from '../domain/document';
import { PayoutNotFoundError } from '../domain/errors';
import type { PayoutId, TransactionId } from '../domain/ids';
import type { Payout } from '../domain/payout';
import type { Transaction } from '../domain/transaction';
import type { TransactionFee } from '../domain/transaction-fee';
import type { DocumentRepository } from '../ports/document-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface GetPayoutTrailDependencies {
  readonly payouts: PayoutRepository;
  readonly transactions: TransactionRepository;
  readonly documents: DocumentRepository;
}

export interface GetPayoutTrailCommand {
  readonly payoutId: PayoutId;
}

export interface TrailNode {
  readonly transaction: Transaction;
  readonly fees: readonly TransactionFee[];
  readonly documents: readonly Document[];
  readonly children: readonly TrailNode[];
}

export interface PayoutTrail {
  readonly payout: Payout;
  readonly roots: readonly TrailNode[];
}

/**
 * UC5 — the money trail as a tree.
 *
 * A leg whose parent is missing from this payout becomes a root rather than
 * disappearing: a broken link should be visible in the trail, not swallowed
 * by it.
 */
export class GetPayoutTrail {
  readonly #deps: GetPayoutTrailDependencies;

  constructor(dependencies: GetPayoutTrailDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: GetPayoutTrailCommand): Promise<PayoutTrail> {
    const { payouts, transactions, documents } = this.#deps;

    const payout = await payouts.findById(command.payoutId);
    if (payout === null) {
      throw new PayoutNotFoundError(command.payoutId);
    }

    const legs = await transactions.listByPayout(payout.id);
    const fees = await transactions.listFeesByPayout(payout.id);

    const feesByLeg = new Map<TransactionId, TransactionFee[]>();
    for (const fee of fees) {
      const bucket = feesByLeg.get(fee.transactionId) ?? [];
      bucket.push(fee);
      feesByLeg.set(fee.transactionId, bucket);
    }

    const documentsByLeg = new Map<TransactionId, readonly Document[]>();
    for (const leg of legs) {
      documentsByLeg.set(
        leg.id,
        await documents.listForTarget({ kind: 'transaction', id: leg.id }),
      );
    }

    const present = new Set(legs.map((leg) => leg.id));
    const childrenByParent = new Map<TransactionId, Transaction[]>();
    const roots: Transaction[] = [];

    for (const leg of legs) {
      if (leg.parentId === null || !present.has(leg.parentId)) {
        roots.push(leg);
        continue;
      }
      const siblings = childrenByParent.get(leg.parentId) ?? [];
      siblings.push(leg);
      childrenByParent.set(leg.parentId, siblings);
    }

    const build = (transaction: Transaction): TrailNode => ({
      transaction,
      fees: feesByLeg.get(transaction.id) ?? [],
      documents: documentsByLeg.get(transaction.id) ?? [],
      children: (childrenByParent.get(transaction.id) ?? []).map(build),
    });

    return { payout, roots: roots.map(build) };
  }
}
