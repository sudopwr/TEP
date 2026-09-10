import type { Account } from './account';
import type { Currency } from './currency';
import { PayoutNotFoundError } from './errors';
import type { AccountId, CompanyId, IsoDate, PayoutId } from './ids';
import { Money, type RoundingMode } from './money';
import type { Transaction } from './transaction';
import type { FeeType, TransactionFee } from './transaction-fee';

/**
 * Derived, never stored.
 *
 * Only two states can be read off the ledger. The schema's third value,
 * 'cancelled', records a human decision that no transaction expresses — it
 * cannot be derived, so it is not offered here.
 */
export type PayoutStatus = 'open' | 'settled';

export interface PayoutProps {
  readonly id: PayoutId;
  readonly code: string;
  readonly companyId: CompanyId;
  readonly payoutDate: IsoDate;
  readonly reference: string | null;
  readonly gross: Money;
  readonly charges: Money;
  readonly notes: string | null;
}

/**
 * A single award from a company, and the root of a transaction tree.
 *
 * The payout stores what was awarded. Everything about what was *realised* —
 * proceeds, fees, net, status — is computed from the legs handed in, because
 * a stored total drifts out of sync the first time a row is edited (§13).
 * That is why every method below takes the transactions as an argument
 * instead of the payout holding them.
 */
export class Payout {
  readonly #props: PayoutProps;

  private constructor(props: PayoutProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: PayoutProps): Payout {
    return new Payout(props);
  }

  static require(payouts: Iterable<Payout>, id: PayoutId): Payout {
    for (const payout of payouts) {
      if (payout.id === id) {
        return payout;
      }
    }
    throw new PayoutNotFoundError(id);
  }

  get id(): PayoutId {
    return this.#props.id;
  }

  get code(): string {
    return this.#props.code;
  }

  get companyId(): CompanyId {
    return this.#props.companyId;
  }

  get payoutDate(): IsoDate {
    return this.#props.payoutDate;
  }

  get reference(): string | null {
    return this.#props.reference;
  }

  get gross(): Money {
    return this.#props.gross;
  }

  get charges(): Money {
    return this.#props.charges;
  }

  get notes(): string | null {
    return this.#props.notes;
  }

  withReference(reference: string | null): Payout {
    return new Payout({ ...this.#props, reference });
  }

  /** This payout's own legs. Anything belonging elsewhere is not ours. */
  #ownLegs(transactions: readonly Transaction[]): readonly Transaction[] {
    return transactions.filter((leg) => leg.payoutId === this.#props.id);
  }

  #ownFees(
    transactions: readonly Transaction[],
    fees: readonly TransactionFee[],
    currency: Currency,
  ): readonly TransactionFee[] {
    const legIds = new Set(this.#ownLegs(transactions).map((leg) => leg.id));
    return fees.filter(
      (fee) => legIds.has(fee.transactionId) && fee.isDenominatedIn(currency),
    );
  }

  /**
   * Gross proceeds across every sale leg, before any fee.
   *
   * Each leg computes its own proceeds from its own from-amount and rate, so
   * four sales at four rates stay four separate roundings — summing first and
   * converting once would quietly disagree with the exchange statement.
   */
  grossProceeds(
    transactions: readonly Transaction[],
    settlementCurrency: Currency,
    rounding: RoundingMode = 'half-up',
  ): Money {
    return this.#ownLegs(transactions)
      .filter((leg) => leg.isSale())
      .reduce(
        (total, sale) => total.add(sale.grossProceeds(rounding)),
        Money.zero(settlementCurrency),
      );
  }

  /** Every fee on this payout's legs denominated in the given currency. */
  totalFees(
    transactions: readonly Transaction[],
    fees: readonly TransactionFee[],
    currency: Currency,
  ): Money {
    return this.#ownFees(transactions, fees, currency).reduce(
      (total, fee) => total.add(fee.amount),
      Money.zero(currency),
    );
  }

  feesByType(
    transactions: readonly Transaction[],
    fees: readonly TransactionFee[],
    currency: Currency,
  ): ReadonlyMap<FeeType, Money> {
    const totals = new Map<FeeType, Money>();

    for (const fee of this.#ownFees(transactions, fees, currency)) {
      const running = totals.get(fee.feeType) ?? Money.zero(currency);
      totals.set(fee.feeType, running.add(fee.amount));
    }

    return totals;
  }

  /**
   * Gross proceeds of all sale legs minus every fee in the settlement
   * currency. The Rise network fee is USD and so falls out on its own rather
   * than by being named and excluded.
   */
  netCredited(
    transactions: readonly Transaction[],
    fees: readonly TransactionFee[],
    settlementCurrency: Currency,
    rounding: RoundingMode = 'half-up',
  ): Money {
    const proceeds = this.grossProceeds(
      transactions,
      settlementCurrency,
      rounding,
    );
    return proceeds.subtract(
      this.totalFees(transactions, fees, settlementCurrency),
    );
  }

  /**
   * Settled once a sale leg has landed in a bank account, open until then.
   * Computed from the legs every time; there is no field behind this.
   */
  status(
    transactions: readonly Transaction[],
    accounts: ReadonlyMap<AccountId, Account>,
  ): PayoutStatus {
    const reachedBank = this.#ownLegs(transactions).some(
      (leg) => leg.isSale() && accounts.get(leg.toAccountId)?.isBank() === true,
    );

    return reachedBank ? 'settled' : 'open';
  }
}
