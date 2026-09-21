import type { Trader } from '../domain/trader';
import type { TraderRepository } from '../ports/trader-repository';

export interface ListTradersDependencies {
  readonly traders: TraderRepository;
}

/**
 * F24's read side — everyone the ledger keeps payouts for.
 *
 * The one query the interface cannot open without: the picker at the top of
 * every screen is built from this, and it is never empty, because `004`
 * creates the trader every existing payout belongs to.
 */
export class ListTraders {
  readonly #deps: ListTradersDependencies;

  constructor(dependencies: ListTradersDependencies) {
    this.#deps = dependencies;
  }

  async execute(): Promise<readonly Trader[]> {
    return this.#deps.traders.list();
  }
}
