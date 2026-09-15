import type { Account, AccountProps, AccountType } from '../domain/account';
import type { AccountId } from '../domain/ids';

export type AccountDraft = Omit<AccountProps, 'id'>;

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>;

  findByCode(code: string): Promise<Account | null>;

  list(): Promise<readonly Account[]>;

  listByType(type: AccountType): Promise<readonly Account[]>;

  insert(draft: AccountDraft): Promise<Account>;

  update(account: Account): Promise<Account>;

  /**
   * Remove an account, with its allow-list, its addresses and its fee
   * schedules — all of which are configuration *for* the account and mean
   * nothing without it.
   *
   * Never its transactions: an account money has moved through cannot be
   * deleted at all, which the schema enforces with ON DELETE RESTRICT and
   * `DeleteAccount` says in a sentence first.
   */
  delete(id: AccountId): Promise<void>;
}
