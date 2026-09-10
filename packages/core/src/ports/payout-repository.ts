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
}
