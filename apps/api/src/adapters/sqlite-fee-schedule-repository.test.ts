import { InvalidFeeScheduleError, Money, USD } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arrangeCounterparties } from '../../test/arrange';
import type { SqliteDatabase } from '../db/connection';

import { SqliteFeeScheduleRepository } from './sqlite-fee-schedule-repository';

describe('SqliteFeeScheduleRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteFeeScheduleRepository;

  beforeEach(() => {
    const arranged = arrangeCounterparties();
    database = arranged.database;
    repository = new SqliteFeeScheduleRepository(database, arranged.currencies);
  });

  afterEach(() => {
    database.close();
  });

  const proportional = (overrides: Record<string, unknown> = {}) => ({
    accountId: 4,
    feeType: 'exchange_fee' as const,
    basis: 'to_amount' as const,
    rateBps: 50,
    flatAmount: null,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    ...overrides,
  });

  const flat = (overrides: Record<string, unknown> = {}) => ({
    accountId: 2,
    feeType: 'network_fee' as const,
    basis: 'flat' as const,
    rateBps: null,
    flatAmount: Money.fromDecimalString('4.00', USD),
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    ...overrides,
  });

  it('round-trips a proportional schedule', async () => {
    const schedule = await repository.insert(proportional());

    expect(schedule.rateBps).toBe(50);
    expect(schedule.flatAmount).toBeNull();
    await expect(repository.findById(schedule.id)).resolves.toEqual(schedule);
  });

  it('round-trips a flat schedule with its own currency', async () => {
    const schedule = await repository.insert(flat());

    expect(schedule.flatAmount?.toDecimalString()).toBe('4.00');
    expect(schedule.flatAmount?.currency.code).toBe('USD');
  });

  it('returns only the schedules in force on a date', async () => {
    await repository.insert(proportional({ effectiveTo: '2025-01-31' }));
    await repository.insert(
      proportional({ rateBps: 60, effectiveFrom: '2025-02-01' }),
    );

    const inForce = await repository.listForAccountOn(4, '2025-03-16');

    expect(inForce).toHaveLength(1);
    expect(inForce[0]?.rateBps).toBe(60);
  });

  it('is inclusive at both ends of the effective window', async () => {
    await repository.insert(
      proportional({ effectiveFrom: '2025-03-16', effectiveTo: '2025-03-16' }),
    );

    await expect(
      repository.listForAccountOn(4, '2025-03-16'),
    ).resolves.toHaveLength(1);
    await expect(
      repository.listForAccountOn(4, '2025-03-17'),
    ).resolves.toHaveLength(0);
  });

  it('does not return another account’s schedules', async () => {
    await repository.insert(flat());

    await expect(repository.listForAccountOn(4, '2025-03-16')).resolves.toEqual(
      [],
    );
  });

  it('agrees with FeeSchedule.appliesOn, which re-checks the same date', async () => {
    await repository.insert(proportional({ effectiveTo: '2025-03-16' }));

    const [schedule] = await repository.listForAccountOn(4, '2025-03-16');

    expect(schedule?.appliesOn('2025-03-16')).toBe(true);
  });

  it('persists an update', async () => {
    const schedule = await repository.insert(proportional());

    const closed = await repository.update(schedule.closedOn('2025-03-31'));

    expect(closed.effectiveTo).toBe('2025-03-31');
    await expect(repository.findById(schedule.id)).resolves.toEqual(closed);
  });

  it('refuses a flat schedule with no amount as a domain error', async () => {
    await expect(repository.insert(flat({ flatAmount: null }))).rejects.toThrow(
      InvalidFeeScheduleError,
    );
  });

  it('refuses a rate on a flat schedule as a domain error', async () => {
    await expect(repository.insert(flat({ rateBps: 50 }))).rejects.toThrow(
      InvalidFeeScheduleError,
    );
  });

  it('refuses a schedule for an account that does not exist', async () => {
    await expect(
      repository.insert(proportional({ accountId: 99 })),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  });
});
