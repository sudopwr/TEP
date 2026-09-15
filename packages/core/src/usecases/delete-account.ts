import type { Account } from '../domain/account';
import { AccountInUseError, AccountNotFoundError } from '../domain/errors';
import type { AccountId } from '../domain/ids';
import type { AccountRepository } from '../ports/account-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface DeleteAccountDependencies {
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
}

export interface DeleteAccountCommand {
  readonly accountId: AccountId;
}

/**
 * F1 — remove an account nothing has ever moved through.
 *
 * The opposite decision from `DeletePayout`, and for a reason worth stating.
 * A payout is a record of something that happened, and deleting it deletes
 * that event and everything derived from it, which is coherent. An account is
 * a *party* to events: deleting one that has legs would leave transactions
 * pointing at nothing, and every balance, trail and check derived from them
 * unreadable. So the schema refuses it (ON DELETE RESTRICT on both
 * `from_account_id` and `to_account_id`) and this says so first, in a
 * sentence with a way out: delete those payouts, or keep the account.
 *
 * Counting the legs rather than asking whether any exist, because "used by 13
 * transactions" tells somebody how much history they are being asked to
 * reconsider, and "used by 1" is a different decision entirely.
 *
 * The whole ledger is scanned, as `GetAccountBalances` (UC7) already does:
 * a few thousand rows is N2's budget many times over, and a port method
 * existing only for this count is what §5 calls a port that has not earned
 * its existence.
 */
export class DeleteAccount {
  readonly #deps: DeleteAccountDependencies;

  constructor(dependencies: DeleteAccountDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: DeleteAccountCommand): Promise<Account> {
    const { accounts, transactions } = this.#deps;

    const account = await accounts.findById(command.accountId);
    if (account === null) {
      throw new AccountNotFoundError(command.accountId);
    }

    const legs = await transactions.list();
    const using = legs.filter(
      (leg) =>
        leg.fromAccountId === account.id || leg.toAccountId === account.id,
    );

    if (using.length > 0) {
      throw new AccountInUseError(account.code, using.length);
    }

    await accounts.delete(account.id);

    return account;
  }
}
