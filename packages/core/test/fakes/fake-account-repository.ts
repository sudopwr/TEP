import { Account, type AccountType } from '../../src/domain/account';
import type { AccountId } from '../../src/domain/ids';
import type {
  AccountDraft,
  AccountRepository,
} from '../../src/ports/account-repository';

export class FakeAccountRepository implements AccountRepository {
  readonly #rows = new Map<AccountId, Account>();
  #nextId = 1;

  seed(...accounts: readonly Account[]): this {
    for (const account of accounts) {
      this.#rows.set(account.id, account);
      this.#nextId = Math.max(this.#nextId, account.id + 1);
    }
    return this;
  }

  findById(id: AccountId): Promise<Account | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findByCode(code: string): Promise<Account | null> {
    for (const account of this.#rows.values()) {
      if (account.code === code) {
        return Promise.resolve(account);
      }
    }
    return Promise.resolve(null);
  }

  list(): Promise<readonly Account[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  listByType(type: AccountType): Promise<readonly Account[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter((account) => account.type === type),
    );
  }

  insert(draft: AccountDraft): Promise<Account> {
    const account = Account.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(account.id, account);
    return Promise.resolve(account);
  }

  update(account: Account): Promise<Account> {
    this.#rows.set(account.id, account);
    return Promise.resolve(account);
  }

  /** The directory shape `Payout.status` expects. */
  directory(): ReadonlyMap<AccountId, Account> {
    return new Map(this.#rows);
  }
}
