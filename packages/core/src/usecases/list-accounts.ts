import type { Account, AccountType } from '../domain/account';
import type { AccountRepository } from '../ports/account-repository';

export interface ListAccountsDependencies {
  readonly accounts: AccountRepository;
}

export interface ListAccountsCommand {
  /** Narrow to one kind — the bank accounts, the exchanges. */
  readonly type?: AccountType;
}

/**
 * Every account, whether or not money has ever moved through it.
 *
 * That last clause is the whole reason this exists next to
 * `GetAccountBalances`. Balances are derived from movements (UC7), so an
 * account that has never taken part in one does not appear there at all —
 * which is fine for a balance sheet and useless for a form asking "where did
 * this money go?". A newly recorded bank account would be invisible to the
 * one screen that needs to offer it.
 */
export class ListAccounts {
  readonly #deps: ListAccountsDependencies;

  constructor(dependencies: ListAccountsDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: ListAccountsCommand = {},
  ): Promise<readonly Account[]> {
    const { accounts } = this.#deps;

    return command.type === undefined
      ? accounts.list()
      : accounts.listByType(command.type);
  }
}
