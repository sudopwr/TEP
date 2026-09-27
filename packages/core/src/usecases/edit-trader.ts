import {
  TraderCodeTakenError,
  TraderNotFoundError,
} from '../domain/errors';
import type { TraderId } from '../domain/ids';
import { Trader } from '../domain/trader';
import type { TraderRepository } from '../ports/trader-repository';

export interface EditTraderDependencies {
  readonly traders: TraderRepository;
}

export interface EditTraderCommand {
  readonly traderId: TraderId;
  readonly code: string;
  readonly name: string;
  readonly notes?: string | null;
}

/**
 * F27 — correct a trader: their code, their name, their notes.
 *
 * A replacement, like `EditAccount`: the caller sends what the trader *is*
 * now. There is nothing here that is dangerous to change — a trader holds
 * only identity (`Trader`), and their payouts hang off the id, which is not
 * editable. Renaming `default` to somebody's actual name is the first thing
 * anybody does, and the migration's own note says so.
 *
 * One check the insert also makes, and one it cannot: the code must be free,
 * *unless* it is already this trader's, which is what lets a name change
 * without a code change and the other way round.
 */
export class EditTrader {
  readonly #deps: EditTraderDependencies;

  constructor(dependencies: EditTraderDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: EditTraderCommand): Promise<Trader> {
    const { traders } = this.#deps;

    const existing = await traders.findById(command.traderId);
    if (existing === null) {
      throw new TraderNotFoundError(command.traderId);
    }

    const byCode = await traders.findByCode(command.code);
    if (byCode !== null && byCode.id !== existing.id) {
      throw new TraderCodeTakenError(command.code);
    }

    return traders.update(
      Trader.create({
        id: existing.id,
        code: command.code,
        name: command.name,
        notes: command.notes ?? null,
      }),
    );
  }
}
