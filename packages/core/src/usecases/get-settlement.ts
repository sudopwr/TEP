import type { Currency, CurrencyRegistry } from '../domain/currency';
import { PayoutNotFoundError } from '../domain/errors';
import type { PayoutId } from '../domain/ids';
import type { Money } from '../domain/money';
import type { Payout, PayoutStatus } from '../domain/payout';
import type { FeeType } from '../domain/transaction-fee';
import type { AccountRepository } from '../ports/account-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface GetSettlementDependencies {
  readonly payouts: PayoutRepository;
  readonly transactions: TransactionRepository;
  readonly accounts: AccountRepository;
  readonly currencies: CurrencyRegistry;
}

export interface GetSettlementCommand {
  readonly payoutId: PayoutId;
  /** Defaults to INR, the only currency a sale produces. */
  readonly settlementCurrencyCode?: string;
}

export interface Settlement {
  readonly payout: Payout;
  readonly status: PayoutStatus;
  readonly currency: Currency;
  readonly grossProceeds: Money;
  readonly feesByType: ReadonlyMap<FeeType, Money>;
  readonly totalFees: Money;
  readonly netCredited: Money;
}

/** UC6 — gross proceeds, fees by type, and net credited for one payout. */
export class GetSettlement {
  readonly #deps: GetSettlementDependencies;

  constructor(dependencies: GetSettlementDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: GetSettlementCommand): Promise<Settlement> {
    const { payouts, transactions, currencies } = this.#deps;

    const payout = await payouts.findById(command.payoutId);
    if (payout === null) {
      throw new PayoutNotFoundError(command.payoutId);
    }

    const currency = currencies.get(command.settlementCurrencyCode ?? 'INR');
    const legs = await transactions.listByPayout(payout.id);
    const fees = await transactions.listFeesByPayout(payout.id);

    return {
      payout,
      status: payout.status(legs, await this.#directory()),
      currency,
      grossProceeds: payout.grossProceeds(legs, currency),
      feesByType: payout.feesByType(legs, fees, currency),
      totalFees: payout.totalFees(legs, fees, currency),
      netCredited: payout.netCredited(legs, fees, currency),
    };
  }

  async #directory() {
    const all = await this.#deps.accounts.list();
    return new Map(all.map((account) => [account.id, account]));
  }
}
