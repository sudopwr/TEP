import type { CurrencyRegistry } from '../domain/currency';
import {
  CompanyNotFoundError,
  NonPositiveAmountError,
  TraderNotFoundError,
} from '../domain/errors';
import type { CompanyId, IsoDate, TraderId } from '../domain/ids';
import { Money } from '../domain/money';
import type { Payout } from '../domain/payout';
import type { Clock } from '../ports/clock';
import type { CompanyRepository } from '../ports/company-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TraderRepository } from '../ports/trader-repository';

export interface RecordPayoutDependencies {
  readonly payouts: PayoutRepository;
  readonly companies: CompanyRepository;
  readonly traders: TraderRepository;
  readonly currencies: CurrencyRegistry;
  readonly clock: Clock;
}

export interface RecordPayoutCommand {
  readonly code: string;
  readonly companyId: CompanyId;
  /** Whose award it is (F24). Required: every payout belongs to somebody. */
  readonly traderId: TraderId;
  /** Defaults to today, from the injected clock. */
  readonly payoutDate?: IsoDate;
  readonly grossAmount: string;
  readonly currencyCode: string;
  readonly charges?: string;
  readonly reference?: string | null;
  readonly notes?: string | null;
}

/** UC1 — record a payout in `open` status. */
export class RecordPayout {
  readonly #deps: RecordPayoutDependencies;

  constructor(dependencies: RecordPayoutDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordPayoutCommand): Promise<Payout> {
    const { payouts, companies, traders, currencies, clock } = this.#deps;

    const company = await companies.findById(command.companyId);
    if (company === null) {
      throw new CompanyNotFoundError(command.companyId);
    }

    // The same check for the same reason: `payouts.trader_id` is a real
    // foreign key, and a wrong id should read as a wrong id rather than as a
    // server fault.
    const trader = await traders.findById(command.traderId);
    if (trader === null) {
      throw new TraderNotFoundError(command.traderId);
    }

    const currency = currencies.get(command.currencyCode);
    const gross = Money.fromDecimalString(command.grossAmount, currency);

    if (!gross.isPositive()) {
      throw new NonPositiveAmountError(
        `Payout '${command.code}'`,
        'grossAmount',
        gross.toString(),
      );
    }

    const charges =
      command.charges === undefined
        ? Money.zero(currency)
        : Money.fromDecimalString(command.charges, currency);

    if (charges.isNegative()) {
      throw new NonPositiveAmountError(
        `Payout '${command.code}'`,
        'charges',
        charges.toString(),
      );
    }

    return payouts.insert({
      code: command.code,
      companyId: company.id,
      traderId: trader.id,
      payoutDate: command.payoutDate ?? clock.today(),
      reference: command.reference ?? null,
      gross,
      charges,
      notes: command.notes ?? null,
    });
  }
}
