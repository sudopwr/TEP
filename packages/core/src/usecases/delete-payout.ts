import { PayoutNotFoundError } from '../domain/errors';
import type { PayoutId } from '../domain/ids';
import type { Payout } from '../domain/payout';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface DeletePayoutDependencies {
  readonly payouts: PayoutRepository;
  readonly transactions: TransactionRepository;
}

export interface DeletePayoutCommand {
  readonly payoutId: PayoutId;
}

/**
 * What went, reported back so the caller can say so.
 *
 * The payout is the row as it was a moment before, not a handle to anything:
 * by the time this is read there is nothing on file with that id. It is here
 * because "Payout deleted" is a worse sentence than "TradeifyPayout001
 * deleted, with 13 legs", and the caller cannot look the code up afterwards.
 */
export interface PayoutDeleted {
  readonly payout: Payout;
  readonly transactionsDeleted: number;
  readonly feesDeleted: number;
}

/**
 * Delete a payout, with its legs, their fees and its document links.
 *
 * Deliberately not a "cancel" flag. §13 says status is derived and never
 * stored, so a cancelled payout would be a fourth state nothing computes and
 * every total would have to remember to exclude — which is precisely how the
 * spreadsheet this replaced came to hold two figures for the same money.
 * A payout recorded by mistake leaves, and every derived view (balances, the
 * checks, the financial-year report) simply stops seeing it.
 *
 * The counts are taken *before* the delete, because afterwards there is
 * nothing left to count. They are also why this needs the transaction
 * repository at all: the cascade itself belongs to the adapter, which does it
 * in one unit of work (`PayoutRepository.delete`).
 *
 * What it will not do is refuse a payout that has legs. Requiring them to be
 * unpicked one at a time would make correcting a mistyped import an
 * afternoon's work, and §7's invariants are about what is *impossible*, not
 * about what is unwise — the confirmation belongs in front of the reader, not
 * in here.
 */
export class DeletePayout {
  readonly #deps: DeletePayoutDependencies;

  constructor(dependencies: DeletePayoutDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: DeletePayoutCommand): Promise<PayoutDeleted> {
    const { payouts, transactions } = this.#deps;

    const payout = await payouts.findById(command.payoutId);
    if (payout === null) {
      throw new PayoutNotFoundError(command.payoutId);
    }

    const legs = await transactions.listByPayout(payout.id);
    const fees = await transactions.listFeesByPayout(payout.id);

    await payouts.delete(payout.id);

    return {
      payout,
      transactionsDeleted: legs.length,
      feesDeleted: fees.length,
    };
  }
}
