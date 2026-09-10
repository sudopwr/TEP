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
}
