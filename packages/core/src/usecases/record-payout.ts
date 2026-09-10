import type { CurrencyRegistry } from '../domain/currency';
import { CompanyNotFoundError, NonPositiveAmountError } from '../domain/errors';
import type { CompanyId, IsoDate } from '../domain/ids';
import { Money } from '../domain/money';
import type { Payout } from '../domain/payout';
import type { Clock } from '../ports/clock';
import type { CompanyRepository } from '../ports/company-repository';
import type { PayoutRepository } from '../ports/payout-repository';

export interface RecordPayoutDependencies {
  readonly payouts: PayoutRepository;
  readonly companies: CompanyRepository;
  readonly currencies: CurrencyRegistry;
  readonly clock: Clock;
}

export interface RecordPayoutCommand {
  readonly code: string;
  readonly companyId: CompanyId;
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
    const { payouts, companies, currencies, clock } = this.#deps;

    const company = await companies.findById(command.companyId);
    if (company === null) {
      throw new CompanyNotFoundError(command.companyId);
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
      payoutDate: command.payoutDate ?? clock.today(),
      reference: command.reference ?? null,
      gross,
      charges,
      notes: command.notes ?? null,
    });
  }
}
