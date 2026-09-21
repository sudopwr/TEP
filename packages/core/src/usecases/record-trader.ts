import { TraderCodeTakenError } from '../domain/errors';
import type { Trader } from '../domain/trader';
import type { TraderRepository } from '../ports/trader-repository';

export interface RecordTraderDependencies {
  readonly traders: TraderRepository;
}

export interface RecordTraderCommand {
  readonly code: string;
  readonly name: string;
  readonly notes?: string | null;
}

/**
 * F24 — record a person whose payouts this ledger keeps.
 *
 * One check, and it duplicates a UNIQUE constraint on purpose, per §7's
 * "unless the message needs to be friendlier": `SQLITE_CONSTRAINT_UNIQUE` is
 * not a sentence, and a code collision is a fixable mistake rather than a
 * server fault.
 *
 * No password, no session, no invitation. A trader is a name on money (§5a
 * keeps the only credential), which is why adding one is this small.
 */
export class RecordTrader {
  readonly #deps: RecordTraderDependencies;

  constructor(dependencies: RecordTraderDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordTraderCommand): Promise<Trader> {
    const { traders } = this.#deps;

    const existing = await traders.findByCode(command.code);
    if (existing !== null) {
      throw new TraderCodeTakenError(command.code);
    }

    return traders.insert({
      code: command.code,
      name: command.name,
      notes: command.notes ?? null,
    });
  }
}
