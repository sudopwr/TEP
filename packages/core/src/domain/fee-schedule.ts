import { InvalidFeeScheduleError } from './errors';
import type { AccountId, FeeScheduleId, IsoDate } from './ids';
import type { Money } from './money';
import type { FeeType } from './transaction-fee';

/**
 * What a rate is a percentage *of*.
 *
 * `exchange_fee` is the odd one: it names another fee rather than a side of
 * the transaction, which is why GST cannot be computed in the same pass as
 * the fee it derives from.
 */
export type FeeBasis = 'to_amount' | 'from_amount' | 'exchange_fee' | 'flat';

export interface FeeScheduleProps {
  readonly id: FeeScheduleId;
  readonly accountId: AccountId;
  readonly feeType: FeeType;
  readonly basis: FeeBasis;
  /** Basis points: 50 is 0.50%, 1800 is 18%. Null exactly when basis is flat. */
  readonly rateBps: number | null;
  /** Null exactly when the basis is not flat. Carries its own currency. */
  readonly flatAmount: Money | null;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
}

/**
 * A declared fee rule, so a report can predict a fee and the data-quality
 * pass can catch a wrong one. Rates live here rather than in code, which is
 * what makes §11's open question — order value or net proceeds? — a data
 * change rather than a code change.
 */
export class FeeSchedule {
  readonly #props: FeeScheduleProps;

  private constructor(props: FeeScheduleProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: FeeScheduleProps): FeeSchedule {
    const { id, basis, rateBps, flatAmount, effectiveFrom, effectiveTo } =
      props;

    const isFlat = basis === 'flat';

    if (isFlat !== (flatAmount !== null)) {
      throw new InvalidFeeScheduleError(
        id,
        isFlat
          ? 'a flat basis needs a flat amount'
          : `a '${basis}' basis must not carry a flat amount`,
      );
    }

    if (isFlat !== (rateBps === null)) {
      throw new InvalidFeeScheduleError(
        id,
        isFlat
          ? 'a flat basis must not carry a rate'
          : `a '${basis}' basis needs a rate in basis points`,
      );
    }

    if (rateBps !== null) {
      if (!Number.isInteger(rateBps)) {
        throw new InvalidFeeScheduleError(
          id,
          `rate ${rateBps} is not a whole number of basis points`,
        );
      }
      if (rateBps < 0) {
        throw new InvalidFeeScheduleError(id, `rate ${rateBps} is negative`);
      }
    }

    if (flatAmount !== null && flatAmount.isNegative()) {
      throw new InvalidFeeScheduleError(
        id,
        `flat amount ${flatAmount.toString()} is negative`,
      );
    }

    if (effectiveTo !== null && effectiveTo < effectiveFrom) {
      throw new InvalidFeeScheduleError(
        id,
        `it ends on ${effectiveTo}, before it starts on ${effectiveFrom}`,
      );
    }

    return new FeeSchedule(props);
  }

  get id(): FeeScheduleId {
    return this.#props.id;
  }

  get accountId(): AccountId {
    return this.#props.accountId;
  }

  get feeType(): FeeType {
    return this.#props.feeType;
  }

  get basis(): FeeBasis {
    return this.#props.basis;
  }

  get rateBps(): number | null {
    return this.#props.rateBps;
  }

  get flatAmount(): Money | null {
    return this.#props.flatAmount;
  }

  get effectiveFrom(): IsoDate {
    return this.#props.effectiveFrom;
  }

  get effectiveTo(): IsoDate | null {
    return this.#props.effectiveTo;
  }

  /** Inclusive at both ends. ISO dates compare correctly as strings. */
  appliesOn(date: IsoDate): boolean {
    const { effectiveFrom, effectiveTo } = this.#props;
    return (
      date >= effectiveFrom && (effectiveTo === null || date <= effectiveTo)
    );
  }

  closedOn(date: IsoDate): FeeSchedule {
    return FeeSchedule.create({ ...this.#props, effectiveTo: date });
  }
}
