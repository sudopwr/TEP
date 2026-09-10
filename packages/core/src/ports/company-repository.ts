import type { Company, CompanyProps } from '../domain/company';
import type { CompanyId } from '../domain/ids';

/** A company that has not been persisted, and so has no id yet. */
export type CompanyDraft = Omit<CompanyProps, 'id'>;

export interface CompanyRepository {
  findById(id: CompanyId): Promise<Company | null>;

  findByCode(code: string): Promise<Company | null>;

  list(): Promise<readonly Company[]>;

  /** Inserts and returns the row with the id the database allocated. */
  insert(draft: CompanyDraft): Promise<Company>;

  update(company: Company): Promise<Company>;
}
