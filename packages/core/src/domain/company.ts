import type { CompanyId } from './ids';

export interface CompanyProps {
  readonly id: CompanyId;
  readonly code: string;
  readonly name: string;
  readonly notes: string | null;
}

/** A prop firm or a payment processor. Immutable; changes return a copy. */
export class Company {
  readonly #props: CompanyProps;

  private constructor(props: CompanyProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: CompanyProps): Company {
    return new Company(props);
  }

  get id(): CompanyId {
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

  rename(name: string): Company {
    return new Company({ ...this.#props, name });
  }

  withNotes(notes: string | null): Company {
    return new Company({ ...this.#props, notes });
  }

  /** Identity is the id, not the field values. A rename is the same company. */
  equals(other: Company): boolean {
    return this.#props.id === other.id;
  }
}
