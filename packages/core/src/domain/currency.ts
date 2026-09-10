import { InvalidCurrencyError, UnknownCurrencyError } from './errors';

/**
 * A currency and the number of decimal places it is stored with.
 *
 * `scale` is the single source of truth for how a minor-unit integer maps to
 * a human amount: INR 2 means 4599 is ₹45.99; USDT 8 means 75317770000 is
 * 753.1777 USDT. Money never contains these numbers — it asks a Currency.
 */
export interface Currency {
  readonly code: string;
  readonly scale: number;
}

/**
 * The set of currencies the application knows about.
 *
 * Seeded here for the domain's own use and for tests. In the running app the
 * definitions come from the `currencies` table, so this class is constructed
 * from rows rather than from the literal below — same shape, different source.
 */
export class CurrencyRegistry {
  readonly #byCode: Map<string, Currency>;

  constructor(definitions: readonly Currency[]) {
    this.#byCode = new Map();

    for (const definition of definitions) {
      const { code, scale } = definition;

      if (code.length === 0) {
        throw new InvalidCurrencyError(code, 'the code cannot be empty');
      }
      if (!Number.isInteger(scale)) {
        throw new InvalidCurrencyError(
          code,
          `scale ${scale} is not an integer`,
        );
      }
      if (scale < 0 || scale > 18) {
        throw new InvalidCurrencyError(
          code,
          `scale ${scale} is outside the storable range 0-18`,
        );
      }
      if (this.#byCode.has(code)) {
        throw new InvalidCurrencyError(code, 'defined twice');
      }

      this.#byCode.set(code, Object.freeze({ code, scale }));
    }
  }

  get(code: string): Currency {
    const currency = this.#byCode.get(code);
    if (currency === undefined) {
      throw new UnknownCurrencyError(code);
    }
    return currency;
  }

  has(code: string): boolean {
    return this.#byCode.has(code);
  }

  codes(): readonly string[] {
    return [...this.#byCode.keys()];
  }
}

/** The three currencies this application moves money through. */
export const currencies = new CurrencyRegistry([
  { code: 'INR', scale: 2 },
  { code: 'USD', scale: 2 },
  { code: 'USDT', scale: 8 },
]);

export const INR = currencies.get('INR');
export const USD = currencies.get('USD');
export const USDT = currencies.get('USDT');
