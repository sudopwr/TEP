import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import {
  AccountCodeTakenError,
  AccountNotFoundError,
  CompanyNotFoundError,
  UnknownCurrencyError,
} from '../domain/errors';

import { EditAccount, type EditAccountCommand } from './edit-account';

const setup = () => {
  const world = TestWorld.withCounterparties();
  const useCase = new EditAccount({
    accounts: world.accounts,
    companies: world.companies,
    currencies: world.currencies,
  });

  return { world, useCase };
};

const command = (
  overrides: Partial<EditAccountCommand> = {},
): EditAccountCommand => ({
  accountId: reference.COINDCX.id,
  code: reference.COINDCX.code,
  name: reference.COINDCX.name,
  type: reference.COINDCX.type,
  allowedCurrencies: ['USDT', 'INR'],
  ...overrides,
});

describe('EditAccount', () => {
  it('renames an account, keeping its id', async () => {
    const { world, useCase } = setup();

    const edited = await useCase.execute(command({ name: 'CoinDCX (INR)' }));

    expect(edited.id).toBe(reference.COINDCX.id);
    expect(edited.name).toBe('CoinDCX (INR)');
    await expect(
      world.accounts.findById(reference.COINDCX.id),
    ).resolves.toEqual(edited);
  });

  it('accepts the account keeping its own code', async () => {
    // The check `RecordAccount` cannot have: a code is taken *by somebody
    // else*, and editing the name of an account must not trip over its own.
    const { useCase } = setup();

    const edited = await useCase.execute(command({ name: 'Renamed' }));

    expect(edited.code).toBe(reference.COINDCX.code);
  });

  it('refuses a code that belongs to another account', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ code: reference.BANK.code })),
    ).rejects.toBeInstanceOf(AccountCodeTakenError);
  });

  it('replaces the allow-list rather than adding to it', async () => {
    const { useCase } = setup();

    const edited = await useCase.execute(
      command({ allowedCurrencies: ['INR'] }),
    );

    expect(edited.allowedCurrencies).toEqual(['INR']);
  });

  it('empties the allow-list when none are given, which means anything', async () => {
    // §7: an empty list is a real choice, not a missing value — and a patch
    // would have no way to say it. The field is left out entirely rather than
    // sent as undefined, which is what a caller omitting it actually does.
    const { useCase } = setup();
    const { allowedCurrencies: _omitted, ...withoutList } = command();

    const edited = await useCase.execute(withoutList);

    expect(edited.allowedCurrencies).toEqual([]);
    expect(edited.allows('INR')).toBe(true);
  });

  it('stores the allow-list as a sorted set', async () => {
    const { useCase } = setup();

    const edited = await useCase.execute(
      command({ allowedCurrencies: ['USDT', 'INR', 'USDT'] }),
    );

    expect(edited.allowedCurrencies).toEqual(['INR', 'USDT']);
  });

  it('changes the kind, which the settlement then derives from', async () => {
    const { useCase } = setup();

    const edited = await useCase.execute(command({ type: 'bank' }));

    expect(edited.isBank()).toBe(true);
  });

  it('attaches and detaches a company', async () => {
    const { useCase } = setup();

    const attached = await useCase.execute(
      command({ companyId: reference.TRADEIFY.id }),
    );
    expect(attached.companyId).toBe(reference.TRADEIFY.id);

    const detached = await useCase.execute(command({ companyId: null }));
    expect(detached.companyId).toBeNull();
  });

  it('refuses an account that is not there', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ accountId: 4242 })),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('refuses a company that is not there', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ companyId: 999 })),
    ).rejects.toBeInstanceOf(CompanyNotFoundError);
  });

  it('refuses a currency the ledger does not know', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ allowedCurrencies: ['XYZ'] })),
    ).rejects.toBeInstanceOf(UnknownCurrencyError);
  });

  it('leaves every other account alone', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command({ name: 'Renamed' }));

    await expect(world.accounts.findById(reference.BANK.id)).resolves.toEqual(
      reference.BANK,
    );
  });
});
