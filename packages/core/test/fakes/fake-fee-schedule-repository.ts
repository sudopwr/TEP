import { FeeSchedule } from '../../src/domain/fee-schedule';
import type { AccountId, FeeScheduleId, IsoDate } from '../../src/domain/ids';
import type {
  FeeScheduleDraft,
  FeeScheduleRepository,
} from '../../src/ports/fee-schedule-repository';

export class FakeFeeScheduleRepository implements FeeScheduleRepository {
  readonly #rows = new Map<FeeScheduleId, FeeSchedule>();
  #nextId = 1;

  seed(...schedules: readonly FeeSchedule[]): this {
    for (const schedule of schedules) {
      this.#rows.set(schedule.id, schedule);
      this.#nextId = Math.max(this.#nextId, schedule.id + 1);
    }
    return this;
  }

  findById(id: FeeScheduleId): Promise<FeeSchedule | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  list(): Promise<readonly FeeSchedule[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  listForAccountOn(
    accountId: AccountId,
    date: IsoDate,
  ): Promise<readonly FeeSchedule[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (schedule) =>
          schedule.accountId === accountId && schedule.appliesOn(date),
      ),
    );
  }

  insert(draft: FeeScheduleDraft): Promise<FeeSchedule> {
    const schedule = FeeSchedule.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(schedule.id, schedule);
    return Promise.resolve(schedule);
  }

  update(schedule: FeeSchedule): Promise<FeeSchedule> {
    this.#rows.set(schedule.id, schedule);
    return Promise.resolve(schedule);
  }
}
