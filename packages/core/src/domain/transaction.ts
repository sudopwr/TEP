import {
  InvalidRateError,
  NonPositiveAmountError,
  ParentPayoutMismatchError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
} from './errors';
import type { AccountId, IsoDate, PayoutId, TransactionId } from './ids';
import type { Money, RoundingMode } from './money';

/** The runtime list; the type is derived from it. See DOCUMENT_TYPES. */
export const TRANSACTION_KINDS = [
  'payout_credit',
  'withdrawal',
  'transfer',
  'sale',
  'deposit',
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export interface TransactionProps {
  readonly id: TransactionId;
  readonly code: string;
  readonly payoutId: PayoutId;
  readonly parentId: TransactionId | null;
  readonly txnDate: IsoDate;
  readonly kind: TransactionKind;
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  readonly fromAmount: Money;
  readonly toAmount: Money;
  readonly rate: bigint | null;
  /**
   * The platform's own reference for each side, always TEXT.
   *
   * CLAUDE.md §9 defect 3: Excel turned one of these into `1.43908E+19` and
   * the digits are gone for good. Whatever survived is kept verbatim — a
   * reference that has been through a float is still the only handle on that
   * transfer, and re-parsing it as a number would finish the job.
   */
  readonly fromExternalRef?: string | null;
  readonly toExternalRef?: string | null;
  readonly notes?: string | null;
}

type StoredProps = TransactionProps & {
  readonly fromExternalRef: string | null;
  readonly toExternalRef: string | null;
  readonly notes: string | null;
};

/**
 * One movement of value between two accounts, and a node in the payout tree.
 *
 * The three invariants the document calls impossible are checked here so the
 * error arrives with a name and structured fields rather than as a SQLite
 * constraint message. Date format and self-parenting are left to the database
 * per CLAUDE.md §7 — nothing would be gained by saying them twice.
 */
export class Transaction {
  readonly #props: StoredProps;

  private constructor(props: StoredProps) {
    this.#props = Object.freeze(props);
  }

  static record(props: TransactionProps): Transaction {
    const { code, fromAccountId, toAccountId, fromAmount, toAmount, rate } =
      props;

    if (fromAccountId === toAccountId) {
      throw new SameAccountTransferError(code, fromAccountId);
    }

    if (!fromAmount.isPositive()) {
      throw new NonPositiveAmountError(
        `Transaction '${code}'`,
        'fromAmount',
        fromAmount.toString(),
      );
    }

    if (!toAmount.isPositive()) {
      throw new NonPositiveAmountError(
        `Transaction '${code}'`,
        'toAmount',
        toAmount.toString(),
      );
    }

    if (rate !== null) {
      if (rate <= 0n) {
        throw new InvalidRateError(rate, 'a rate must be greater than zero');
      }
      if (fromAmount.currency.code === toAmount.currency.code) {
        throw new RateOnSameCurrencyError(code, fromAmount.currency.code, rate);
      }
    }

    return new Transaction({
      ...props,
      fromExternalRef: props.fromExternalRef ?? null,
      toExternalRef: props.toExternalRef ?? null,
      notes: props.notes ?? null,
    });
  }

  get id(): TransactionId {
    return this.#props.id;
  }

  get code(): string {
    return this.#props.code;
  }

  get payoutId(): PayoutId {
    return this.#props.payoutId;
  }

  get parentId(): TransactionId | null {
    return this.#props.parentId;
  }

  get txnDate(): IsoDate {
    return this.#props.txnDate;
  }

  get kind(): TransactionKind {
    return this.#props.kind;
  }

  get fromAccountId(): AccountId {
    return this.#props.fromAccountId;
  }

  get toAccountId(): AccountId {
    return this.#props.toAccountId;
  }

  get fromAmount(): Money {
    return this.#props.fromAmount;
  }

  get toAmount(): Money {
    return this.#props.toAmount;
  }

  get rate(): bigint | null {
    return this.#props.rate;
  }

  get fromExternalRef(): string | null {
    return this.#props.fromExternalRef;
  }

  get toExternalRef(): string | null {
    return this.#props.toExternalRef;
  }

  get notes(): string | null {
    return this.#props.notes;
  }

  /**
   * What this leg is worth before fees.
   *
   * With a rate, it is computed from the from-amount so the arithmetic is
   * reproducible rather than trusted; without one, the recorded to-amount is
   * the only thing we know. Rounding defaults to half-up, which is what the
   * exchange statements use and what the §10 figures reproduce.
   */
  grossProceeds(rounding: RoundingMode = 'half-up'): Money {
    const { rate, fromAmount, toAmount } = this.#props;

    if (rate === null) {
      return toAmount;
    }

    return fromAmount.multiplyByRate(rate, toAmount.currency, rounding);
  }

  isSale(): boolean {
    return this.#props.kind === 'sale';
  }

  /** Hang this leg off a parent, refusing a parent from another payout. */
  attachTo(parent: Transaction): Transaction {
    if (parent.payoutId !== this.#props.payoutId) {
      throw new ParentPayoutMismatchError(
        this.#props.code,
        this.#props.payoutId,
        parent.code,
        parent.payoutId,
      );
    }

    return new Transaction({ ...this.#props, parentId: parent.id });
  }

  withNotes(notes: string | null): Transaction {
    return new Transaction({ ...this.#props, notes });
  }
}
