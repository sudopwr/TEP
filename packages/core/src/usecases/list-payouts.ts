import type { CompanyId, TraderId } from '../domain/ids';
import type { Payout } from '../domain/payout';
import type { DateRange, PayoutRepository } from '../ports/payout-repository';

import { payoutsInScope } from './payout-scope';

export interface ListPayoutsDependencies {
  readonly payouts: PayoutRepository;
}

export interface ListPayoutsCommand {
  readonly companyId?: CompanyId;
  /** Whose payouts (F24). Omit for everybody's. */
  readonly traderId?: TraderId;
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

    // The trader and the range are the shared scope, narrowed by the
    // repository wherever an index can do it; the company is this screen's
    // own filter and rides on top.
    if (
      command.companyId !== undefined &&
      command.traderId === undefined &&
      command.range === undefined
    ) {
      return payouts.listByCompany(command.companyId);
    }

    const inScope = await payoutsInScope(payouts, {
      ...(command.traderId === undefined ? {} : { traderId: command.traderId }),
      ...(command.range === undefined ? {} : { range: command.range }),
    });

    return command.companyId === undefined
      ? inScope
      : inScope.filter((one) => one.companyId === command.companyId);
  }
}
