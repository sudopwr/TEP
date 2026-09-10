import type { Currency } from './currency';
import { CurrencyNotAllowedError } from './errors';
import type { AccountId, CompanyId } from './ids';

export type AccountType =
  'prop_firm' | 'processor' | 'exchange' | 'wallet' | 'bank';

export interface AccountProps {
  readonly id: AccountId;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly companyId: CompanyId | null;
  /** Allow-list. Empty means genuinely multi-currency, not "none". */
  readonly allowedCurrencies: readonly string[];
}

/** Anywhere money can sit: prop firm, processor, exchange, wallet, bank. */
export class Account {
  readonly #props: AccountProps;

  private constructor(props: AccountProps) {
    this.#props = Object.freeze({
      ...props,
      allowedCurrencies: Object.freeze([...props.allowedCurrencies]),
    });
  }

  static create(props: AccountProps): Account {
    return new Account(props);
  }

  get id(): AccountId {
    return this.#props.id;
  }

  get code(): string {
    return this.#props.code;
  }

  get name(): string {
    return this.#props.name;
  }

  get type(): AccountType {
    return this.#props.type;
  }

  get companyId(): CompanyId | null {
    return this.#props.companyId;
  }

  get allowedCurrencies(): readonly string[] {
    return this.#props.allowedCurrencies;
  }

  isBank(): boolean {
    return this.#props.type === 'bank';
  }

  /**
   * An empty allow-list permits everything, mirroring `v_data_quality`, which
   * only checks accounts that have rows in `account_currencies` at all.
   */
  allows(currencyCode: string): boolean {
    const allowed = this.#props.allowedCurrencies;
    return allowed.length === 0 || allowed.includes(currencyCode);
  }

  assertCanHold(currency: Currency): void {
    if (!this.allows(currency.code)) {
      throw new CurrencyNotAllowedError(
        this.#props.id,
        this.#props.code,
        currency.code,
        this.#props.allowedCurrencies,
      );
    }
  }

  allowCurrency(currencyCode: string): Account {
    if (this.#props.allowedCurrencies.includes(currencyCode)) {
      return new Account(this.#props);
    }
    return new Account({
      ...this.#props,
      allowedCurrencies: [...this.#props.allowedCurrencies, currencyCode],
    });
  }
}
