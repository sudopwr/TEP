import { Account, type AccountType } from '../domain/account';
import type { CurrencyRegistry } from '../domain/currency';
import {
  AccountCodeTakenError,
  AccountNotFoundError,
  CompanyNotFoundError,
} from '../domain/errors';
import type { AccountId } from '../domain/ids';
import type { AccountRepository } from '../ports/account-repository';
import type { CompanyRepository } from '../ports/company-repository';

export interface EditAccountDependencies {
  readonly accounts: AccountRepository;
  readonly companies: CompanyRepository;
  readonly currencies: CurrencyRegistry;
}

export interface EditAccountCommand {
  readonly accountId: AccountId;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly companyId?: number | null;
  /** The whole allow-list, not an addition. Empty means "holds anything". */
  readonly allowedCurrencies?: readonly string[];
}

/**
 * F1 — correct an account that was recorded wrongly.
 *
 * A replacement rather than a patch: the caller sends what the account *is*
 * now, and what it does not send it does not have. That matters most for the
 * allow-list, where the two readings diverge — under a patch, omitting it
 * would mean "leave it alone" and there would be no way to say "it holds
 * anything now" at all, since an empty list is itself a meaningful value
 * (`Account.allows`).
 *
 * The same three checks as `RecordAccount`, each duplicating a constraint so
 * the message is a sentence, plus one the insert cannot have: the code may
 * still belong to *this* account, which is what makes renaming everything but
 * the code possible.
 *
 * **Narrowing the allow-list is allowed even when legs already contradict
 * it.** §7 puts "a currency the destination cannot hold" among the things
 * `v_data_quality` *flags* rather than among the impossible ones; refusing the
 * edit would mean an account mis-recorded as INR-only could never be
 * corrected without deleting the history that proves the correction is right.
 * The flag is the report that it happened.
 */
export class EditAccount {
  readonly #deps: EditAccountDependencies;

  constructor(dependencies: EditAccountDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: EditAccountCommand): Promise<Account> {
    const { accounts, companies, currencies } = this.#deps;

    const existing = await accounts.findById(command.accountId);
    if (existing === null) {
      throw new AccountNotFoundError(command.accountId);
    }

    const byCode = await accounts.findByCode(command.code);
    if (byCode !== null && byCode.id !== existing.id) {
      throw new AccountCodeTakenError(command.code);
    }

    const companyId = command.companyId ?? null;
    if (companyId !== null) {
      const company = await companies.findById(companyId);
      if (company === null) {
        throw new CompanyNotFoundError(companyId);
      }
    }

    const allowed = command.allowedCurrencies ?? [];
    for (const code of allowed) {
      // Throws `UnknownCurrencyError`, which the API maps to a 400.
      currencies.get(code);
    }

    return accounts.update(
      Account.create({
        id: existing.id,
        code: command.code,
        name: command.name,
        type: command.type,
        companyId,
        // A set, sorted — the same canonical order `RecordAccount` writes, so
        // that a fake and SQLite (which reads the rows back ordered) cannot
        // disagree about what the same edit produced.
        allowedCurrencies: [...new Set(allowed)].sort(),
      }),
    );
  }
}
