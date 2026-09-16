import type { Account } from '../domain/account';
import type { CurrencyRegistry } from '../domain/currency';
import {
  AccountNotFoundError,
  TransactionNotFoundError,
} from '../domain/errors';
import type { AccountId, IsoDate, TransactionId } from '../domain/ids';
import { Money } from '../domain/money';
import { Transaction } from '../domain/transaction';
import type { AccountRepository } from '../ports/account-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

export interface EditTransactionDependencies {
  readonly transactions: TransactionRepository;
  readonly accounts: AccountRepository;
  readonly currencies: CurrencyRegistry;
}

export interface EditTransactionCommand {
  readonly transactionId: TransactionId;
  readonly code: string;
  readonly txnDate: IsoDate;
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  readonly fromAmount: string;
  readonly fromCurrencyCode: string;
  readonly toAmount: string;
  readonly toCurrencyCode: string;
  readonly rate: bigint | null;
  readonly notes?: string | null;
}

/**
 * F21 — correct a leg that was recorded wrongly.
 *
 * The same checks as recording one (UC2), because an edit can break exactly
 * what an insert can: an account that does not exist, a currency the account
 * is not allowed to hold, a move from an account to itself, a rate on a
 * same-currency move. The first two need the repositories and are here; the
 * rest belong to the entity and fire when it is rebuilt, which is why this
 * constructs a `Transaction` rather than handing the repository loose fields.
 *
 * **What it deliberately cannot change**, each for its own reason:
 *
 *   - the **payout**. A leg belongs to the tree it was recorded in, and
 *     moving it would have to move its parent and its children too — that is
 *     a re-filing of a whole subtree, not a correction of a row.
 *   - the **parent**. Re-parenting restructures the tree and can point a leg
 *     at its own descendant, which no constraint catches (`parent_id <> id`
 *     stops the one-step case and nothing stops a cycle of three). It is a
 *     separate operation with its own reachability check, not a field on this
 *     form.
 *   - the **kind**. A sale's exchange fee and GST came from §8's schedule
 *     through UC3; turning a transfer into one would mean running that
 *     engine, which is `RecordSale`'s job and not a side effect of an edit.
 *   - the **fees**. TDS came off a statement (§8) and is the only authority
 *     for what was actually withheld. Recomputing it because an amount moved
 *     would overwrite evidence with arithmetic.
 *
 * Which leaves the honest consequence: editing a sale's amount or rate can
 * leave its fees no longer matching the schedule, and its `to_amount` no
 * longer reconciling. §7 puts both in `v_data_quality` — *suspicious rather
 * than impossible* — so the checks report it and the reader decides. An edit
 * that silently re-derived the fees would be the version of this that lies.
 */
export class EditTransaction {
  readonly #deps: EditTransactionDependencies;

  constructor(dependencies: EditTransactionDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: EditTransactionCommand): Promise<Transaction> {
    const { transactions, currencies } = this.#deps;

    const existing = await transactions.findById(command.transactionId);
    if (existing === null) {
      throw new TransactionNotFoundError(command.transactionId);
    }

    const fromAccount = await this.#requireAccount(command.fromAccountId);
    const toAccount = await this.#requireAccount(command.toAccountId);

    const fromCurrency = currencies.get(command.fromCurrencyCode);
    const toCurrency = currencies.get(command.toCurrencyCode);

    // An account can no more send a currency it cannot hold than receive one.
    fromAccount.assertCanHold(fromCurrency);
    toAccount.assertCanHold(toCurrency);

    return transactions.update(
      Transaction.record({
        id: existing.id,
        // Carried, not accepted: see the list above.
        payoutId: existing.payoutId,
        parentId: existing.parentId,
        kind: existing.kind,
        code: command.code,
        txnDate: command.txnDate,
        fromAccountId: command.fromAccountId,
        toAccountId: command.toAccountId,
        fromAmount: Money.fromDecimalString(command.fromAmount, fromCurrency),
        toAmount: Money.fromDecimalString(command.toAmount, toCurrency),
        rate: command.rate,
        // The platform's own references survive an edit untouched: §9's
        // defect 3 destroyed one already, and this form does not offer them.
        fromExternalRef: existing.fromExternalRef,
        toExternalRef: existing.toExternalRef,
        notes: command.notes ?? null,
      }),
    );
  }

  async #requireAccount(id: AccountId): Promise<Account> {
    const account = await this.#deps.accounts.findById(id);
    if (account === null) {
      throw new AccountNotFoundError(id);
    }
    return account;
  }
}
