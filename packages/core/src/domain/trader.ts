import type { TraderId } from './ids';

export interface TraderProps {
  readonly id: TraderId;
  readonly code: string;
  readonly name: string;
  readonly notes: string | null;
}

/**
 * A person a payout belongs to.
 *
 * Deliberately not a `User` (§5a): that is the single sign-in account, with a
 * password, a session and a must-change cage. A trader has none of those. One
 * admin keeps the ledger for several people, and the distinction is what
 * stops a name typed into a dropdown becoming a login.
 *
 * It holds nothing but identity. Everything else about a trader — what they
 * were awarded, what reached the bank — is derived from their payouts, which
 * is the same reason §13 keeps status and totals off the payout row.
 */
export class Trader {
  readonly #props: TraderProps;

  private constructor(props: TraderProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: TraderProps): Trader {
    return new Trader(props);
  }

  get id(): TraderId {
    return this.#props.id;
  }

  get code(): string {
    return this.#props.code;
  }

  get name(): string {
    return this.#props.name;
  }

  get notes(): string | null {
    return this.#props.notes;
  }

  rename(name: string): Trader {
    return new Trader({ ...this.#props, name });
  }

  withNotes(notes: string | null): Trader {
    return new Trader({ ...this.#props, notes });
  }
}
