import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';

import { GenerateFinancialYearReport } from './generate-financial-year-report';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new GenerateFinancialYearReport({
    payouts: world.payouts,
    companies: world.companies,
    transactions: world.transactions,
    currencies: world.currencies,
    clock: world.clock,
  });
  return { world, useCase };
};

const FY_2024_25 = { from: '2024-04-01', to: '2025-03-31' };

describe('GenerateFinancialYearReport (UC10)', () => {
  it('totals credited, TDS and fees over the range', async () => {
    const { useCase } = setup();

    const report = await useCase.execute({ range: FY_2024_25 });

    expect(report.totalCredited.toDecimalString()).toBe('84642.93');
    expect(report.totalTds.toDecimalString()).toBe('868.88');
    expect(report.totalFees.toDecimalString()).toBe('1384.63');
  });

  it('groups by company', async () => {
    const { useCase } = setup();

    const report = await useCase.execute({ range: FY_2024_25 });

    expect(report.byCompany).toHaveLength(1);
    expect(report.byCompany[0]?.company.name).toBe('Tradeify');
    expect(report.byCompany[0]?.payoutCount).toBe(1);
    expect(report.byCompany[0]?.credited.toDecimalString()).toBe('84642.93');
    expect(report.byCompany[0]?.tds.toDecimalString()).toBe('868.88');
  });

  it('excludes a payout outside the range', async () => {
    const { useCase } = setup();

    const report = await useCase.execute({
      range: { from: '2025-04-01', to: '2026-03-31' },
    });

    expect(report.totalCredited.isZero()).toBe(true);
    expect(report.byCompany).toEqual([]);
  });

  it('includes a payout on the first day of the range', async () => {
    const { useCase } = setup();

    const report = await useCase.execute({
      range: { from: '2025-03-10', to: '2025-03-10' },
    });

    expect(report.totalCredited.toDecimalString()).toBe('84642.93');
  });

  it('defaults to the Indian financial year around the clock', async () => {
    const { world, useCase } = setup();
    world.clock.set('2025-03-16T10:30:00.000Z');

    const report = await useCase.execute({});

    // 16 March 2025 falls inside FY 2024-25: 1 Apr 2024 to 31 Mar 2025.
    expect(report.range).toEqual(FY_2024_25);
    expect(report.totalCredited.toDecimalString()).toBe('84642.93');
  });

  it('rolls to the next financial year once April arrives', async () => {
    const { world, useCase } = setup();
    world.clock.set('2025-04-01T00:00:00.000Z');

    const report = await useCase.execute({});

    expect(report.range).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('reports in rupees by default', async () => {
    const { useCase } = setup();

    const report = await useCase.execute({ range: FY_2024_25 });

    expect(report.currency.code).toBe('INR');
  });

  it('is empty, not an error, when there are no payouts at all', async () => {
    const world = TestWorld.withCounterparties();
    const useCase = new GenerateFinancialYearReport({
      payouts: world.payouts,
      companies: world.companies,
      transactions: world.transactions,
      currencies: world.currencies,
      clock: world.clock,
    });

    const report = await useCase.execute({ range: FY_2024_25 });

    expect(report.byCompany).toEqual([]);
    expect(report.totalFees.isZero()).toBe(true);
  });
});
