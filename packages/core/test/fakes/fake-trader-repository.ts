import type { TraderId } from '../../src/domain/ids';
import { Trader } from '../../src/domain/trader';
import type {
  TraderDraft,
  TraderRepository,
} from '../../src/ports/trader-repository';

export class FakeTraderRepository implements TraderRepository {
  readonly #rows = new Map<TraderId, Trader>();
  #nextId = 1;

  seed(...traders: readonly Trader[]): this {
    for (const trader of traders) {
      this.#rows.set(trader.id, trader);
      this.#nextId = Math.max(this.#nextId, trader.id + 1);
    }
    return this;
  }

  findById(id: TraderId): Promise<Trader | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByCode(code: string): Promise<Trader | null> {
    for (const trader of this.#rows.values()) {
      if (trader.code === code) {
        return Promise.resolve(trader);
      }
    }
    return Promise.resolve(null);
  }

  list(): Promise<readonly Trader[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  insert(draft: TraderDraft): Promise<Trader> {
    const trader = Trader.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(trader.id, trader);
    return Promise.resolve(trader);
  }

  update(trader: Trader): Promise<Trader> {
    this.#rows.set(trader.id, trader);
    return Promise.resolve(trader);
  }

  size(): number {
    return this.#rows.size;
  }
}
