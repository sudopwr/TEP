import type { CompanyId } from '../domain/ids';
import type { Payout } from '../domain/payout';
import type { DateRange, PayoutRepository } from '../ports/payout-repository';

export interface ListPayoutsDependencies {
  readonly payouts: PayoutRepository;
}

export interface ListPayoutsCommand {
  readonly companyId?: CompanyId;
  readonly range?: DateRange;
}

/**
 * F2's read side — the payout list, optionally narrowed.
 *
 * The narrowing happens in the repository, not here: `listByCompany` and
 * `listByDateRange` are indexed queries, and filtering a full table in
 * JavaScript would quietly turn N2 ("under 100ms on a few thousand rows")
 * into a promise this layer cannot keep.
 */
export class ListPayouts {
  readonly #deps: ListPayoutsDependencies;

  constructor(dependencies: ListPayoutsDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: ListPayoutsCommand = {}): Promise<readonly Payout[]> {
    const { payouts } = this.#deps;

    if (command.companyId !== undefined && command.range !== undefined) {
      const inRange = await payouts.listByDateRange(command.range);
      return inRange.filter((one) => one.companyId === command.companyId);
    }

    if (command.companyId !== undefined) {
      return payouts.listByCompany(command.companyId);
    }

    if (command.range !== undefined) {
      return payouts.listByDateRange(command.range);
    }

    return payouts.list();
  }
}
