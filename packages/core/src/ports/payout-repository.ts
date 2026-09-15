import type { CompanyId, IsoDate, PayoutId } from '../domain/ids';
import type { Payout, PayoutProps } from '../domain/payout';

export type PayoutDraft = Omit<PayoutProps, 'id'>;

/** Inclusive on both ends, matching how a financial year is quoted. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface PayoutRepository {
  findById(id: PayoutId): Promise<Payout | null>;

  findByCode(code: string): Promise<Payout | null>;

  list(): Promise<readonly Payout[]>;

  listByCompany(companyId: CompanyId): Promise<readonly Payout[]>;

  /** Drives the financial-year report (UC10). */
  listByDateRange(range: DateRange): Promise<readonly Payout[]>;

  insert(draft: PayoutDraft): Promise<Payout>;

  update(payout: Payout): Promise<Payout>;

  /**
   * Remove a payout and everything that hangs off it, all or nothing.
   *
   * Its transactions and their fees go with it, and so do the document links
   * that pointed at either — but never the documents themselves: one file may
   * be evidence for several things (F6), and deleting the payout it happened
   * to be uploaded from would take a statement away from a company it is
   * still attached to.
   *
   * Deleting something that is not there is not an error; the use case has
   * already established that it was, and a second opinion from the adapter
   * would only be a race.
   */
  delete(id: PayoutId): Promise<void>;
}
