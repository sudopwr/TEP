import type { Currency } from './currency';
import { NonPositiveAmountError } from './errors';
import type { TransactionFeeId, TransactionId } from './ids';
import type { Money } from './money';

export type FeeType =
  'tds' | 'exchange_fee' | 'gst' | 'network_fee' | 'platform_charge';

export interface TransactionFeeProps {
  readonly id: TransactionFeeId;
  readonly transactionId: TransactionId;
  readonly feeType: FeeType;
  readonly amount: Money;
}

/**
 * A fee as a row rather than a column, carrying its own currency: TDS is INR,
 * the Rise withdrawal fee is USD, and both can hang off the same tree.
 *
 * Zero is allowed — a recorded zero fee is a fact, not a mistake — but a
 * negative fee is a refund wearing a disguise and belongs in its own row.
 */
export class TransactionFee {
  readonly #props: TransactionFeeProps;

  private constructor(props: TransactionFeeProps) {
    this.#props = Object.freeze({ ...props });
  }

  static record(props: TransactionFeeProps): TransactionFee {
    TransactionFee.#assertNotNegative(props.feeType, props.amount);
    return new TransactionFee(props);
  }

  static #assertNotNegative(feeType: FeeType, amount: Money): void {
    if (amount.isNegative()) {
      throw new NonPositiveAmountError(
        `Fee '${feeType}'`,
        'amount',
        amount.toString(),
      );
    }
  }

  get id(): TransactionFeeId {
    return this.#props.id;
  }

  get transactionId(): TransactionId {
    return this.#props.transactionId;
  }

  get feeType(): FeeType {
    return this.#props.feeType;
  }

  get amount(): Money {
    return this.#props.amount;
  }

  isDenominatedIn(currency: Currency): boolean {
    return this.#props.amount.currency.code === currency.code;
  }

  withAmount(amount: Money): TransactionFee {
    TransactionFee.#assertNotNegative(this.#props.feeType, amount);
    return new TransactionFee({ ...this.#props, amount });
  }
}
