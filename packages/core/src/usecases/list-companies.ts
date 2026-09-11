import type { Company } from '../domain/company';
import type { CompanyRepository } from '../ports/company-repository';

export interface ListCompaniesDependencies {
  readonly companies: CompanyRepository;
}

/**
 * F1's read side.
 *
 * A one-line pass-through today, and that is fine: it exists so the route
 * layer has a use case to call rather than a repository, which is what keeps
 * "no business logic in routes" checkable rather than aspirational. The day
 * companies need filtering or an archived flag, this is where it goes.
 */
export class ListCompanies {
  readonly #deps: ListCompaniesDependencies;

  constructor(dependencies: ListCompaniesDependencies) {
    this.#deps = dependencies;
  }

  async execute(): Promise<readonly Company[]> {
    return this.#deps.companies.list();
  }
}
