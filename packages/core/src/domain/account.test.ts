import { describe, expect, it } from 'vitest';

import { Account } from './account';
import { INR, USD, USDT } from './currency';
import { CurrencyNotAllowedError } from './errors';

const coindcx = () =>
  Account.create({
    id: 4,
    code: 'coindcx',
    name: 'CoinDCX',
    type: 'exchange',
    companyId: null,
    allowedCurrencies: ['USDT', 'INR'],
  });

const bank = () =>
  Account.create({
    id: 5,
    code: 'bank-hdfc',
    name: 'HDFC',
    type: 'bank',
    companyId: null,
    allowedCurrencies: ['INR'],
  });

const openWallet = () =>
  Account.create({
    id: 3,
    code: 'trustwallet',
    name: 'TrustWallet',
    type: 'wallet',
    companyId: null,
    allowedCurrencies: [],
  });

describe('Account', () => {
  it('carries its type and its allow-list', () => {
    const account = coindcx();

    expect(account.type).toBe('exchange');
    expect(account.allowedCurrencies).toEqual(['USDT', 'INR']);
  });

  it('knows whether it is a bank', () => {
    expect(bank().isBank()).toBe(true);
    expect(coindcx().isBank()).toBe(false);
  });

  it('allows a currency on its list', () => {
    expect(coindcx().allows('USDT')).toBe(true);
    expect(coindcx().allows('INR')).toBe(true);
  });

  it('refuses a currency off its list', () => {
    expect(coindcx().allows('USD')).toBe(false);
    expect(bank().allows('USDT')).toBe(false);
  });

  it('treats an empty allow-list as genuinely multi-currency', () => {
    // Mirrors v_data_quality, which only checks accounts that have rows in
    // account_currencies at all.
    expect(openWallet().allows('USDT')).toBe(true);
    expect(openWallet().allows('INR')).toBe(true);
  });

  it('assertCanHold passes for a permitted currency', () => {
    expect(() => bank().assertCanHold(INR)).not.toThrow();
    expect(() => coindcx().assertCanHold(USDT)).not.toThrow();
  });

  it('assertCanHold throws CurrencyNotAllowedError otherwise', () => {
    expect(() => bank().assertCanHold(USDT)).toThrow(CurrencyNotAllowedError);
    expect(() => coindcx().assertCanHold(USD)).toThrow(CurrencyNotAllowedError);
  });

  it('carries structured fields on the error, not just a message', () => {
    try {
      bank().assertCanHold(USDT);
      expect.unreachable('assertCanHold should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyNotAllowedError);
      const failure = error as CurrencyNotAllowedError;
      expect(failure.accountId).toBe(5);
      expect(failure.accountCode).toBe('bank-hdfc');
      expect(failure.currencyCode).toBe('USDT');
      expect(failure.allowed).toEqual(['INR']);
    }
  });

  it('widens the allow-list into a new instance', () => {
    const original = bank();
    const widened = original.allowCurrency('USD');

    expect(widened.allows('USD')).toBe(true);
    expect(original.allows('USD')).toBe(false);
  });

  it('does not duplicate a currency already allowed', () => {
    expect(bank().allowCurrency('INR').allowedCurrencies).toEqual(['INR']);
  });

  it('exposes an allow-list that cannot be mutated through the getter', () => {
    const account = coindcx();
    const list = account.allowedCurrencies;

    expect(() => {
      (list as string[]).push('USD');
    }).toThrow();
    expect(account.allows('USD')).toBe(false);
  });
});
