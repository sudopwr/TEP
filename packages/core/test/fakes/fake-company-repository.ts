import { Company } from '../../src/domain/company';
import type { CompanyId } from '../../src/domain/ids';
import type {
  CompanyDraft,
  CompanyRepository,
} from '../../src/ports/company-repository';

export class FakeCompanyRepository implements CompanyRepository {
  readonly #rows = new Map<CompanyId, Company>();
  #nextId = 1;

  /** Seed without going through insert, for arranging a test. */
  seed(...companies: readonly Company[]): this {
    for (const company of companies) {
      this.#rows.set(company.id, company);
      this.#nextId = Math.max(this.#nextId, company.id + 1);
    }
    return this;
  }

  findById(id: CompanyId): Promise<Company | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByCode(code: string): Promise<Company | null> {
    for (const company of this.#rows.values()) {
      if (company.code === code) {
        return Promise.resolve(company);
      }
    }
    return Promise.resolve(null);
  }

  list(): Promise<readonly Company[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  insert(draft: CompanyDraft): Promise<Company> {
    const company = Company.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(company.id, company);
    return Promise.resolve(company);
  }

  update(company: Company): Promise<Company> {
    this.#rows.set(company.id, company);
    return Promise.resolve(company);
  }

  size(): number {
    return this.#rows.size;
  }
}
