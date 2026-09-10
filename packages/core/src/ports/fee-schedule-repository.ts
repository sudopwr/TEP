import type { FeeSchedule, FeeScheduleProps } from '../domain/fee-schedule';
import type { AccountId, FeeScheduleId, IsoDate } from '../domain/ids';

export type FeeScheduleDraft = Omit<FeeScheduleProps, 'id'>;

export interface FeeScheduleRepository {
  findById(id: FeeScheduleId): Promise<FeeSchedule | null>;

  list(): Promise<readonly FeeSchedule[]>;

  /**
   * Every schedule for an account in effect on a date — the exact input the
   * fee engine expects. The engine re-checks the date anyway, so an adapter
   * that returns a wider set is wrong but not dangerous.
   */
  listForAccountOn(
    accountId: AccountId,
    date: IsoDate,
  ): Promise<readonly FeeSchedule[]>;

  insert(draft: FeeScheduleDraft): Promise<FeeSchedule>;

  update(schedule: FeeSchedule): Promise<FeeSchedule>;
}
