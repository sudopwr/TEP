import { ChainLookupUnavailableError } from '@payout/core';
import { describe, expect, it, vi } from 'vitest';

import { HttpChainLookup } from './http-chain-lookup';

/**
 * F29 — the one adapter that leaves the machine, with the machine stubbed.
 *
 * Every test here hands in its own `fetch`, so the suite never touches the
 * network and the assertions can be about the *request* as much as the
 * answer: which host, which hash, and — the one that matters most — that
 * a USDT transfer's real recipient is read out of the call data rather than
 * taken from `to`, which is the token contract on every single one of them.
 */

const HASH =
  '0xe167419f8be1f9383aae00ca0508b1c85cf0a0cf31c187d38ecf18e53fcc7a94';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

/** A `transfer(address,uint256)` call: method id, address, amount. */
const transferInput = (to: string, amount = 1_000_000n): string =>
  `0xa9059cbb${to.slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`;

const answering = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('HttpChainLookup, Ethereum and its lookalikes', () => {
  it('reads the sender and the recipient of a plain transfer', async () => {
    const fetch = answering({
      jsonrpc: '2.0',
      result: { from: SENDER, to: RECIPIENT, input: '0x' },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toEqual({
      fromAddress: SENDER,
      toAddress: RECIPIENT,
    });
  });

  it('reads a token transfer’s real recipient out of the call data', async () => {
    /*
      The trap the whole feature would otherwise fall into.

      Every USDT transfer on Ethereum has `to` = the token contract, so a
      ledger filled from `to` would record `0xdac17f…` as the destination
      wallet of every transfer — consistently, plausibly and wrongly.
    */
    const fetch = answering({
      result: { from: SENDER, to: USDT, input: transferInput(RECIPIENT) },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toEqual({
      fromAddress: SENDER,
      toAddress: RECIPIENT.toLowerCase(),
      tokenContract: USDT,
    });
  });

  it('leaves the destination unread when the call is one it cannot decode', async () => {
    // A swap, a multisend, an exchange's own withdrawal contract. Better an
    // empty field the reader fills than a confident wrong address.
    const fetch = answering({
      result: { from: SENDER, to: USDT, input: '0x38ed1739deadbeef' },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toEqual({ fromAddress: SENDER, toAddress: USDT });
  });

  it('asks the right chain, and never the pasted link', async () => {
    const fetch = answering({ result: { from: SENDER, to: RECIPIENT } });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'secret', fetch });

    await lookup.find({ chain: 'bsc', hash: HASH });

    const [url] = fetch.mock.calls[0] as [string];
    expect(url).toContain('https://api.etherscan.io/v2/api?');
    expect(url).toContain('chainid=56');
    expect(url).toContain(`txhash=${HASH}`);
    expect(url).toContain('apikey=secret');
  });

  it('answers null for a hash the chain has never seen', async () => {
    const fetch = answering({ jsonrpc: '2.0', id: 1, result: null });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    await expect(
      lookup.find({ chain: 'ethereum', hash: HASH }),
    ).resolves.toBeNull();
  });

  it('says it cannot read rather than "not found" when there is no key', async () => {
    // Different facts, different messages: one means the link is wrong, the
    // other means this application is not set up and the fields still work.
    const fetch = vi.fn();
    const lookup = new HttpChainLookup({ fetch });

    expect(lookup.canRead({ chain: 'ethereum', hash: HASH })).toBe(false);
    await expect(
      lookup.find({ chain: 'ethereum', hash: HASH }),
    ).rejects.toBeInstanceOf(ChainLookupUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns a rate limit into the same honest failure', async () => {
    const fetch = answering({
      status: '0',
      message: 'NOTOK',
      result: 'Max rate limit reached',
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    await expect(
      lookup.find({ chain: 'ethereum', hash: HASH }),
    ).rejects.toThrow(/Max rate limit reached/);
  });

  it('survives a 500, a hang and a page of HTML', async () => {
    const cases: (() => typeof globalThis.fetch)[] = [
      () => answering({}, 500) as unknown as typeof globalThis.fetch,
      () =>
        vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
          ) as unknown as typeof globalThis.fetch,
      () =>
        vi
          .fn()
          .mockResolvedValue(
            new Response('<html>down for maintenance</html>', { status: 200 }),
          ) as unknown as typeof globalThis.fetch,
    ];

    for (const make of cases) {
      const lookup = new HttpChainLookup({
        etherscanApiKey: 'key',
        fetch: make(),
      });

      await expect(
        lookup.find({ chain: 'ethereum', hash: HASH }),
      ).rejects.toBeInstanceOf(ChainLookupUnavailableError);
    }
  });

  it('refuses to follow a redirect', async () => {
    // An explorer that 302s somewhere is an explorer this does not read:
    // following it would be fetching an address nothing approved.
    const fetch = answering({ result: { from: SENDER, to: RECIPIENT } });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    await lookup.find({ chain: 'ethereum', hash: HASH });

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });
});

describe('HttpChainLookup, Tron', () => {
  const TRON_HASH = 'a'.repeat(64);
  const OWNER = 'TQ5NMqJjW3kG4pM4Y7mHs2jWc1ZLsz9Xsa';
  const TO = 'TXYZopqrstuvwxyz1234567890ABCDEFGH';

  it('needs no key, because Tronscan needs none', async () => {
    const fetch = answering({
      hash: TRON_HASH,
      ownerAddress: OWNER,
      toAddress: TO,
    });
    const lookup = new HttpChainLookup({ fetch });

    expect(lookup.canRead({ chain: 'tron', hash: TRON_HASH })).toBe(true);
    await expect(
      lookup.find({ chain: 'tron', hash: TRON_HASH }),
    ).resolves.toEqual({ fromAddress: OWNER, toAddress: TO });
  });

  it('prefers the TRC-20 transfer, which is where the USDT went', async () => {
    // §10's own route. The contract call's `toAddress` is the token; the
    // transfer inside it is the person.
    const fetch = answering({
      hash: TRON_HASH,
      ownerAddress: OWNER,
      toAddress: 'TTokenContract000000000000000000000',
      trc20TransferInfo: [
        {
          from_address: OWNER,
          to_address: TO,
          contract_address: 'TTokenContract000000000000000000000',
        },
      ],
    });
    const lookup = new HttpChainLookup({ fetch });

    await expect(
      lookup.find({ chain: 'tron', hash: TRON_HASH }),
    ).resolves.toEqual({
      fromAddress: OWNER,
      toAddress: TO,
      tokenContract: 'TTokenContract000000000000000000000',
    });
  });

  it('answers null for the empty object Tronscan sends for an unknown hash', async () => {
    const lookup = new HttpChainLookup({ fetch: answering({}) });

    await expect(
      lookup.find({ chain: 'tron', hash: TRON_HASH }),
    ).resolves.toBeNull();
  });
});
