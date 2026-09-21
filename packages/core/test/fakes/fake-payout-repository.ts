import type { CompanyId, PayoutId, TraderId } from '../../src/domain/ids';
import { Payout } from '../../src/domain/payout';
import type {
  DateRange,
  PayoutDraft,
  PayoutRepository,
} from '../../src/ports/payout-repository';

/** What a payout takes with it. `FakeTransactionRepository` satisfies it. */
export interface PayoutCascade {
  deleteByPayout(payoutId: PayoutId): number;
}

export class FakePayoutRepository implements PayoutRepository {
  readonly #rows = new Map<PayoutId, Payout>();
  #cascade: PayoutCascade | null = null;
  #nextId = 1;

  seed(...payouts: readonly Payout[]): this {
    for (const payout of payouts) {
      this.#rows.set(payout.id, payout);
      this.#nextId = Math.max(this.#nextId, payout.id + 1);
    }
    return this;
  }

  findById(id: PayoutId): Promise<Payout | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByCode(code: string): Promise<Payout | null> {
    for (const payout of this.#rows.values()) {
      if (payout.code === code) {
        return Promise.resolve(payout);
      }
    }
    return Promise.resolve(null);
  }

  list(): Promise<readonly Payout[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  listByTrader(traderId: TraderId): Promise<readonly Payout[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (payout) => payout.traderId === traderId,
      ),
    );
  }

  listByCompany(companyId: CompanyId): Promise<readonly Payout[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (payout) => payout.companyId === companyId,
      ),
    );
  }

  listByDateRange(range: DateRange): Promise<readonly Payout[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (payout) =>
          payout.payoutDate >= range.from && payout.payoutDate <= range.to,
      ),
    );
  }

  insert(draft: PayoutDraft): Promise<Payout> {
    const payout = Payout.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(payout.id, payout);
    return Promise.resolve(payout);
  }

  update(payout: Payout): Promise<Payout> {
    this.#rows.set(payout.id, payout);
    return Promise.resolve(payout);
  }

  /**
   * Takes the legs with it, exactly as the SQLite adapter's one unit of work
   * does — a fake that quietly left them behind would let a use-case test
   * pass against a world no database can produce.
   */
  delete(id: PayoutId): Promise<void> {
    this.#rows.delete(id);
    this.#cascade?.deleteByPayout(id);
    return Promise.resolve();
  }

  /** Wired by `TestWorld`, so the two fakes agree about what a delete means. */
  cascadeTo(transactions: PayoutCascade): this {
    this.#cascade = transactions;
    return this;
  }

  size(): number {
    return this.#rows.size;
  }
}
