import { CompanyCodeTakenError } from '../domain/errors';
import type { Company } from '../domain/company';
import type { CompanyRepository } from '../ports/company-repository';

export interface RecordCompanyDependencies {
  readonly companies: CompanyRepository;
}

export interface RecordCompanyCommand {
  readonly code: string;
  readonly name: string;
  readonly notes?: string | null;
}

/**
 * F1 — record a prop firm or a payment processor.
 *
 * Not one of §3's numbered use cases: UC1-UC14 start at recording a payout
 * and assume the company already exists. Something has to create it, and a
 * route calling a repository directly would be the first piece of business
 * logic to escape this layer.
 *
 * The uniqueness check duplicates the database's UNIQUE constraint on
 * purpose, and only for the message: §7 says constraints are not repeated in
 * application code "unless the message needs to be friendlier", and
 * `SQLITE_CONSTRAINT_UNIQUE` is not a sentence anyone should read. The
 * constraint remains the thing that actually guarantees it — this check
 * races, and losing the race still ends in the right place.
 */
export class RecordCompany {
  readonly #deps: RecordCompanyDependencies;

  constructor(dependencies: RecordCompanyDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordCompanyCommand): Promise<Company> {
    const { companies } = this.#deps;

    const existing = await companies.findByCode(command.code);
    if (existing !== null) {
      throw new CompanyCodeTakenError(command.code);
    }

    return companies.insert({
      code: command.code,
      name: command.name,
      notes: command.notes ?? null,
    });
  }
}
