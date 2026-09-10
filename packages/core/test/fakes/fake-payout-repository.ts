import type { CompanyId, PayoutId } from '../../src/domain/ids';
import { Payout } from '../../src/domain/payout';
import type {
  DateRange,
  PayoutDraft,
  PayoutRepository,
} from '../../src/ports/payout-repository';

export class FakePayoutRepository implements PayoutRepository {
  readonly #rows = new Map<PayoutId, Payout>();
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

  size(): number {
    return this.#rows.size;
  }
}
