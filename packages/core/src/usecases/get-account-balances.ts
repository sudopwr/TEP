import type { Account } from '../domain/account';
import type { Currency } from '../domain/currency';
import type { AccountId, PayoutId } from '../domain/ids';
import { Money } from '../domain/money';
import type { AccountRepository } from '../ports/account-repository';
import type { PayoutRepository } from '../ports/payout-repository';
import type { TransactionRepository } from '../ports/transaction-repository';

import { isNarrowed, payoutsInScope, type PayoutScope } from './payout-scope';

export interface GetAccountBalancesDependencies {
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  /** Only to resolve a scope: whose payouts, and in what period (F24). */
  readonly payouts: PayoutRepository;
}

export interface GetAccountBalancesCommand {
  /** Omit for the whole ledger; supply to scope to one payout. */
  readonly payoutId?: PayoutId;
  /**
   * Whose money and when (F24) — the selection every screen shares.
   *
   * A balance is derived from movements, so scoping it means counting only
   * the legs of the payouts in scope. Two traders' money passes through the
   * same exchange account, and a balance that added both up while the list
   * beside it showed one trader's payouts would be answering a question
   * nobody asked.
   */
  readonly scope?: PayoutScope;
}

export interface AccountBalance {
  readonly account: Account;
  readonly currency: Currency;
  readonly balance: Money;
}

/** The payout ids a scope selects, or null when it selects everything. */
async function payoutIdsInScope(
  payouts: PayoutRepository,
  scope: PayoutScope | undefined,
): Promise<ReadonlySet<PayoutId> | null> {
  if (scope === undefined || !isNarrowed(scope)) {
    return null;
  }

  const selected = await payoutsInScope(payouts, scope);
  return new Set(selected.map((payout) => payout.id));
}

/**
 * UC7 — balance per account per currency, derived from movements every time.
 *
 * A fee denominated in the destination currency is deducted from what
 * arrived, so it debits the receiving account. A fee denominated in the
 * *source* currency is already inside the from-amount — the reconciliation
 * rule is `to_amount = (from_amount - source fees) x rate` — so debiting it
 * again would count it twice. `v_account_balances` in schema.sql does debit
 * it twice, and drives the Rise USD balance to -16.31; this does not.
 */
export class GetAccountBalances {
  readonly #deps: GetAccountBalancesDependencies;

  constructor(dependencies: GetAccountBalancesDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: GetAccountBalancesCommand = {},
  ): Promise<readonly AccountBalance[]> {
    const { accounts, transactions, payouts } = this.#deps;

    const everyLeg =
      command.payoutId === undefined
        ? await transactions.list()
        : await transactions.listByPayout(command.payoutId);
    const everyFee =
      command.payoutId === undefined
        ? await transactions.listFees()
        : await transactions.listFeesByPayout(command.payoutId);

    const inScope = await payoutIdsInScope(payouts, command.scope);
    const legs =
      inScope === null
        ? everyLeg
        : everyLeg.filter((leg) => inScope.has(leg.payoutId));
    const keptLegs = new Set(legs.map((leg) => leg.id));
    const fees =
      inScope === null
        ? everyFee
        : everyFee.filter((fee) => keptLegs.has(fee.transactionId));

    const legById = new Map(legs.map((leg) => [leg.id, leg]));
    const totals = new Map<string, { balance: Money; accountId: AccountId }>();

    const apply = (accountId: AccountId, amount: Money, sign: 1 | -1): void => {
      const key = `${accountId}:${amount.currency.code}`;
      const running = totals.get(key)?.balance ?? Money.zero(amount.currency);
      totals.set(key, {
        accountId,
        balance: sign === 1 ? running.add(amount) : running.subtract(amount),
      });
    };

    for (const leg of legs) {
      apply(leg.toAccountId, leg.toAmount, 1);
      apply(leg.fromAccountId, leg.fromAmount, -1);
    }

    for (const fee of fees) {
      const leg = legById.get(fee.transactionId);
      if (leg === undefined) {
        continue;
      }

      const code = fee.amount.currency.code;

      if (code === leg.toAmount.currency.code) {
        apply(leg.toAccountId, fee.amount, -1);
      } else if (code !== leg.fromAmount.currency.code) {
        // Neither side's currency: charge the payer, who must have settled it.
        apply(leg.fromAccountId, fee.amount, -1);
      }
      // A fee in the source currency is already inside from_amount.
    }

    const directory = new Map(
      (await accounts.list()).map((account) => [account.id, account]),
    );

    const balances: AccountBalance[] = [];

    for (const { accountId, balance } of totals.values()) {
      const account = directory.get(accountId);
      if (account === undefined || balance.isZero()) {
        continue;
      }
      balances.push({ account, currency: balance.currency, balance });
    }

    return balances;
  }
}
