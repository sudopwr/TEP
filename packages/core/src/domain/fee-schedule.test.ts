import { describe, expect, it } from 'vitest';

import { USD } from './currency';
import { InvalidFeeScheduleError } from './errors';
import { FeeSchedule, type FeeScheduleProps } from './fee-schedule';
import { Money } from './money';

const proportional = (overrides: Partial<FeeScheduleProps> = {}): FeeSchedule =>
  FeeSchedule.create({
    id: 1,
    accountId: 4,
    feeType: 'exchange_fee',
    basis: 'to_amount',
    rateBps: 50,
    flatAmount: null,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    ...overrides,
  });

const flat = (overrides: Partial<FeeScheduleProps> = {}): FeeSchedule =>
  FeeSchedule.create({
    id: 3,
    accountId: 2,
    feeType: 'network_fee',
    basis: 'flat',
    rateBps: null,
    flatAmount: Money.fromDecimalString('4.00', USD),
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    ...overrides,
  });

describe('FeeSchedule', () => {
  it('carries its account, type, basis and rate', () => {
    const schedule = proportional();

    expect(schedule.accountId).toBe(4);
    expect(schedule.feeType).toBe('exchange_fee');
    expect(schedule.basis).toBe('to_amount');
    expect(schedule.rateBps).toBe(50);
    expect(schedule.flatAmount).toBeNull();
  });

  describe('the flat/proportional pairing', () => {
    it('requires a flat amount when the basis is flat', () => {
      expect(() => flat({ flatAmount: null })).toThrow(InvalidFeeScheduleError);
    });

    it('forbids a flat amount when the basis is not flat', () => {
      expect(() =>
        proportional({ flatAmount: Money.fromDecimalString('4.00', USD) }),
      ).toThrow(InvalidFeeScheduleError);
    });

    it('requires a rate when the basis is not flat', () => {
      expect(() => proportional({ rateBps: null })).toThrow(
        InvalidFeeScheduleError,
      );
    });

    it('forbids a rate when the basis is flat', () => {
      expect(() => flat({ rateBps: 50 })).toThrow(InvalidFeeScheduleError);
    });

    it('rejects a negative rate', () => {
      expect(() => proportional({ rateBps: -1 })).toThrow(
        InvalidFeeScheduleError,
      );
    });

    it('rejects a non-integer rate — basis points are whole', () => {
      expect(() => proportional({ rateBps: 50.5 })).toThrow(
        InvalidFeeScheduleError,
      );
    });

    it('rejects a negative flat amount', () => {
      expect(() => flat({ flatAmount: Money.fromMinor(-1n, USD) })).toThrow(
        InvalidFeeScheduleError,
      );
    });

    it('rejects an end date before the start date', () => {
      expect(() =>
        proportional({
          effectiveFrom: '2025-02-01',
          effectiveTo: '2025-01-01',
        }),
      ).toThrow(InvalidFeeScheduleError);
    });
  });

  describe('appliesOn', () => {
    it('applies on and after the start date', () => {
      const schedule = proportional({ effectiveFrom: '2025-02-01' });

      expect(schedule.appliesOn('2025-02-01')).toBe(true);
      expect(schedule.appliesOn('2025-03-16')).toBe(true);
    });

    it('does not apply before the start date', () => {
      expect(
        proportional({ effectiveFrom: '2025-06-01' }).appliesOn('2025-03-16'),
      ).toBe(false);
    });

    it('applies up to and including the end date', () => {
      const schedule = proportional({ effectiveTo: '2025-03-16' });

      expect(schedule.appliesOn('2025-03-16')).toBe(true);
      expect(schedule.appliesOn('2025-03-17')).toBe(false);
    });

    it('runs forever with a null end date', () => {
      expect(proportional().appliesOn('2099-12-31')).toBe(true);
    });
  });

  it('is immutable — closing a schedule returns a new instance', () => {
    const open = proportional();
    const closed = open.closedOn('2025-03-31');

    expect(closed.effectiveTo).toBe('2025-03-31');
    expect(open.effectiveTo).toBeNull();
  });
});
