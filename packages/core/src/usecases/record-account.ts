import type { Account, AccountType } from '../domain/account';
import type { CurrencyRegistry } from '../domain/currency';
import { AccountCodeTakenError, CompanyNotFoundError } from '../domain/errors';
import type { AccountRepository } from '../ports/account-repository';
import type { CompanyRepository } from '../ports/company-repository';

export interface RecordAccountDependencies {
  readonly accounts: AccountRepository;
  readonly companies: CompanyRepository;
  readonly currencies: CurrencyRegistry;
}

export interface RecordAccountCommand {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /** The firm or processor this account belongs to, where there is one. */
  readonly companyId?: number | null;
  /**
   * The allow-list, and an empty one means *genuinely multi-currency* rather
   * than "none" — `Account.allows` treats it that way, mirroring
   * `v_data_quality`, which only checks accounts that have rows in
   * `account_currencies` at all. So an empty list is a real choice a caller
   * can make, not a missing value to be filled in with a guess.
   */
  readonly allowedCurrencies?: readonly string[];
}

/**
 * F1's other half — record somewhere money can sit.
 *
 * Not one of §3's numbered use cases, for the same reason `RecordCompany` is
 * not: UC1-UC14 begin at recording a payout and assume the accounts exist.
 * They existed because the legacy import (F12) created them, which is exactly
 * the gap this closes — without it a fresh database can hold a company and a
 * payout and then has nowhere to move money between.
 *
 * Three checks, and each duplicates a database constraint on purpose, per §7's
 * "unless the message needs to be friendlier":
 *
 *   - a code already in use, because `SQLITE_CONSTRAINT_UNIQUE` is not a
 *     sentence anyone should read;
 *   - a company that does not exist, because the FK would otherwise fail at
 *     insert time and surface as a 500;
 *   - a currency that is not in the `currencies` table, because
 *     `account_currencies.currency_code` is an FK to it, and "no such
 *     currency" is a fixable mistake rather than a server fault.
 *
 * All three race, and losing the race still ends in the right place — the
 * constraints remain the thing that actually guarantees any of it.
 */
export class RecordAccount {
  readonly #deps: RecordAccountDependencies;

  constructor(dependencies: RecordAccountDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: RecordAccountCommand): Promise<Account> {
    const { accounts, companies, currencies } = this.#deps;

    const existing = await accounts.findByCode(command.code);
    if (existing !== null) {
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

    return accounts.insert({
      code: command.code,
      name: command.name,
      type: command.type,
      companyId,
      /*
        De-duplicated and sorted, because the allow-list is a set.

        De-duplicated rather than left to the composite primary key, which
        would accept the list and silently store one row fewer than was asked
        for. Sorted because `account_currencies` is read back
        `ORDER BY currency_code` while an in-memory repository returns what it
        was given — the contract run found the two worlds disagreeing on
        exactly that, and a canonical order makes them indistinguishable
        instead of making the test look the other way.
      */
      allowedCurrencies: [...new Set(allowed)].sort(),
    });
  }
}
