import type { Company } from '../domain/company';
import type { Currency, CurrencyRegistry } from '../domain/currency';
import { CompanyNotFoundError } from '../domain/errors';
import type { CompanyId, IsoDate, TraderId } from '../domain/ids';
import { Money } from '../domain/money';
import type { Clock } from '../ports/clock';
import type { CompanyRepository } from '../ports/company-repository';
import type { DateRange, PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

import { payoutsInScope } from './payout-scope';

export interface GenerateFinancialYearReportDependencies {
  readonly payouts: PayoutRepository;
  readonly companies: CompanyRepository;
  readonly transactions: TransactionRepository;
  readonly currencies: CurrencyRegistry;
  readonly clock: Clock;
}

export interface GenerateFinancialYearReportCommand {
  /** Defaults to the Indian financial year containing today. */
  readonly range?: DateRange;
  readonly settlementCurrencyCode?: string;
  /** Whose year it is (F24). Omit to report on everybody's. */
  readonly traderId?: TraderId;
}

export interface CompanyTotals {
  readonly company: Company;
  readonly payoutCount: number;
  readonly credited: Money;
  readonly tds: Money;
  readonly fees: Money;
}

export interface FinancialYearReport {
  readonly range: DateRange;
  readonly currency: Currency;
  readonly totalCredited: Money;
  readonly totalTds: Money;
  readonly totalFees: Money;
  readonly byCompany: readonly CompanyTotals[];
}

/** 1 April to 31 March, the year the Indian tax year is quoted by. */
export function financialYearContaining(date: IsoDate): DateRange {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;

  return {
    from: `${String(startYear)}-04-01`,
    to: `${String(startYear + 1)}-03-31`,
  };
}

/** UC10 — credited, TDS and fees over a date range, grouped by company. */
export class GenerateFinancialYearReport {
  readonly #deps: GenerateFinancialYearReportDependencies;

  constructor(dependencies: GenerateFinancialYearReportDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: GenerateFinancialYearReportCommand = {},
  ): Promise<FinancialYearReport> {
    const { payouts, companies, transactions, currencies, clock } = this.#deps;

    const currency = currencies.get(command.settlementCurrencyCode ?? 'INR');
    const range = command.range ?? financialYearContaining(clock.today());

    const accumulators = new Map<
      CompanyId,
      { payoutCount: number; credited: Money; tds: Money; fees: Money }
    >();

    const inScope = await payoutsInScope(payouts, {
      range,
      ...(command.traderId === undefined ? {} : { traderId: command.traderId }),
    });

    for (const payout of inScope) {
      const legs = await transactions.listByPayout(payout.id);
      const fees = await transactions.listFeesByPayout(payout.id);

      const running = accumulators.get(payout.companyId) ?? {
        payoutCount: 0,
        credited: Money.zero(currency),
        tds: Money.zero(currency),
        fees: Money.zero(currency),
      };

      accumulators.set(payout.companyId, {
        payoutCount: running.payoutCount + 1,
        credited: running.credited.add(
          payout.netCredited(legs, fees, currency),
        ),
        tds: running.tds.add(
          payout.feesByType(legs, fees, currency).get('tds') ??
            Money.zero(currency),
        ),
        fees: running.fees.add(payout.totalFees(legs, fees, currency)),
      });
    }

    const byCompany: CompanyTotals[] = [];
    let totalCredited = Money.zero(currency);
    let totalTds = Money.zero(currency);
    let totalFees = Money.zero(currency);

    for (const [companyId, totals] of accumulators) {
      const company = await companies.findById(companyId);
      if (company === null) {
        throw new CompanyNotFoundError(companyId);
      }

      byCompany.push({ company, ...totals });
      totalCredited = totalCredited.add(totals.credited);
      totalTds = totalTds.add(totals.tds);
      totalFees = totalFees.add(totals.fees);
    }

    return {
      range,
      currency,
      totalCredited,
      totalTds,
      totalFees,
      byCompany,
    };
  }
}
