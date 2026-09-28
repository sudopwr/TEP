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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const answering = (body: unknown, status = 200) =>
  vi.fn().mockImplementation(() => json(body, status));

/**
 * The proxy, answering each action in turn.
 *
 * A fresh `Response` per call — a body can only be read once — and keyed on
 * the action, because a lookup is now up to four requests: the transaction,
 * its receipt, and the token's `decimals()` and `symbol()`.
 */
const proxy = (answers: {
  transaction?: unknown;
  receipt?: unknown;
  decimals?: string;
  symbol?: string;
}) =>
  vi.fn().mockImplementation((url: string) => {
    if (url.includes('eth_getTransactionByHash')) {
      return json({ result: answers.transaction ?? null });
    }
    if (url.includes('eth_getTransactionReceipt')) {
      return json({ result: answers.receipt ?? null });
    }
    if (url.includes(`data=${DECIMALS_CALL}`)) {
      return json({ result: answers.decimals ?? word(6) });
    }
    if (url.includes(`data=${SYMBOL_CALL}`)) {
      return json({ result: answers.symbol ?? encodedString('USDT') });
    }

    return json({ result: null });
  });

const DECIMALS_CALL = '0x313ce567';
const SYMBOL_CALL = '0x95d89b41';

/** A uint256 as the RPC writes it. */
const word = (value: number | bigint): string =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;

/** An address in a 32-byte topic. */
const topic = (address: string): string =>
  `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

/** A `string` as Solidity ABI-encodes one: offset, length, bytes. */
const encodedString = (text: string): string => {
  const bytes = [...text]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');

  return `0x${word(32).slice(2)}${word(text.length).slice(2)}${bytes.padEnd(64, '0')}`;
};

/** One ERC-20 `Transfer` log, as a receipt carries it. */
const transferLog = (
  from: string,
  to: string,
  value: bigint,
  contract = USDT,
) => ({
  address: contract,
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    topic(from),
    topic(to),
  ],
  data: word(value),
});

describe('HttpChainLookup, Ethereum and its lookalikes', () => {
  it('reads the sender and the recipient of a plain transfer', async () => {
    const fetch = proxy({
      transaction: { from: SENDER, to: RECIPIENT, value: '0x0' },
      receipt: { logs: [] },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toEqual({ fromAddress: SENDER, toAddress: RECIPIENT });
  });

  it('reads the token transfer itself, not the call around it', async () => {
    /*
      The trap the whole feature would otherwise fall into.

      Every USDT transfer on Ethereum has `to` = the token contract, so a
      ledger filled from the transaction's own `to` would record `0xdac17f…`
      as the destination wallet of every transfer — consistently, plausibly
      and wrongly. The receipt's `Transfer` event is where the money is.
    */
    const fetch = proxy({
      transaction: { from: SENDER, to: USDT, value: '0x0' },
      receipt: { logs: [transferLog(SENDER, RECIPIENT, 45_957_100n)] },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toEqual({
      fromAddress: SENDER.toLowerCase(),
      toAddress: RECIPIENT.toLowerCase(),
      tokenContract: USDT,
      amount: '45.9571',
      tokenSymbol: 'USDT',
    });
  });

  it('reads a bridge, whose `to` is a proxy and whose data is undecodable', async () => {
    /*
      The transaction from the screenshot that prompted F30: a LayerZero
      OFT send. `to` is "Layer Zero: Optimized Transparent Upgradeable
      Proxy", the call data is a `send(...)` nothing here could decode, and
      the receipt says plainly that 45.9571 USDT went from the adapter to
      `0xD369A0DB…`. That row is what a ledger wants.
    */
    const SIGNER = '0xcbC1D3B66C60EcE2Bb4bBBf9ed81A37C85736027';
    const PROXY = '0x173272739Bd7Aa6e4e214714048a9fE699453059';
    const ADAPTER = '0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee';
    const ARRIVED = '0xD369A0DB8B02c9Bc0A4c3c1A6Ab2A1A51740345Af'.slice(0, 42);

    const fetch = proxy({
      transaction: { from: SIGNER, to: PROXY, input: '0xc7c7f5b3', value: '0x0' },
      receipt: { logs: [transferLog(ADAPTER, ARRIVED, 45_957_100n)] },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toMatchObject({
      fromAddress: ADAPTER.toLowerCase(),
      toAddress: ARRIVED.toLowerCase(),
      amount: '45.9571',
      tokenSymbol: 'USDT',
    });
    // Never the proxy, which is where the transaction went and not the money.
    expect(transfer?.toAddress).not.toBe(PROXY.toLowerCase());
  });

  it('takes the largest movement when a receipt carries several', async () => {
    // A relayer fee, a hop through a pool, a burn and a mint: the one a
    // person means is the big one, which is what "Net Transfers" shows.
    const FEE = '0x3333333333333333333333333333333333333333';
    const fetch = proxy({
      transaction: { from: SENDER, to: USDT, value: '0x0' },
      receipt: {
        logs: [
          transferLog(SENDER, FEE, 250_000n),
          transferLog(SENDER, RECIPIENT, 45_957_100n),
          transferLog(SENDER, FEE, 10_000n),
        ],
      },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer).toMatchObject({
      toAddress: RECIPIENT.toLowerCase(),
      amount: '45.9571',
    });
  });

  it('ignores an NFT moving, which is the same event with one more topic', async () => {
    const nft = transferLog(SENDER, RECIPIENT, 1n);
    const fetch = proxy({
      transaction: { from: SENDER, to: USDT, value: '0x0' },
      receipt: {
        logs: [{ ...nft, topics: [...nft.topics, word(7)] }],
      },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    // No token amount moved, so it falls back to the transaction's own ends.
    await expect(
      lookup.find({ chain: 'ethereum', hash: HASH }),
    ).resolves.toEqual({ fromAddress: SENDER, toAddress: USDT });
  });

  it('offers no amount when the token will not say how many decimals it keeps', async () => {
    // §13's rule about scales, on a chain: read as 18 what is kept at 6 and
    // the number is a million million times too large, and looks fine.
    const fetch = proxy({
      transaction: { from: SENDER, to: USDT, value: '0x0' },
      receipt: { logs: [transferLog(SENDER, RECIPIENT, 45_957_100n)] },
      decimals: '0x',
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    const transfer = await lookup.find({ chain: 'ethereum', hash: HASH });

    expect(transfer?.amount).toBeUndefined();
    expect(transfer?.toAddress).toBe(RECIPIENT.toLowerCase());
  });

  it('asks a token what it is once, however many transfers are read', async () => {
    const fetch = proxy({
      transaction: { from: SENDER, to: USDT, value: '0x0' },
      receipt: { logs: [transferLog(SENDER, RECIPIENT, 1_000_000n)] },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    await lookup.find({ chain: 'ethereum', hash: HASH });
    await lookup.find({ chain: 'ethereum', hash: HASH });

    const asked = fetch.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes(DECIMALS_CALL),
    );
    expect(asked).toHaveLength(1);
  });

  it('reads a plain coin send off the transaction itself', async () => {
    const fetch = proxy({
      transaction: { from: SENDER, to: RECIPIENT, value: '0xde0b6b3a7640000' },
      receipt: { logs: [] },
    });
    const lookup = new HttpChainLookup({ etherscanApiKey: 'key', fetch });

    await expect(
      lookup.find({ chain: 'ethereum', hash: HASH }),
    ).resolves.toEqual({
      fromAddress: SENDER,
      toAddress: RECIPIENT,
      amount: '1',
      tokenSymbol: 'ETH',
    });
  });

  it('asks the right chain, and never the pasted link', async () => {
    const fetch = proxy({
      transaction: { from: SENDER, to: RECIPIENT, value: '0x0' },
      receipt: { logs: [] },
    });
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
    const fetch = proxy({
      transaction: { from: SENDER, to: RECIPIENT, value: '0x0' },
      receipt: { logs: [] },
    });
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
    // transfer inside it is the person, and it carries the amount too.
    const fetch = answering({
      hash: TRON_HASH,
      ownerAddress: OWNER,
      toAddress: 'TTokenContract000000000000000000000',
      trc20TransferInfo: [
        {
          from_address: OWNER,
          to_address: TO,
          contract_address: 'TTokenContract000000000000000000000',
          amount_str: '45957100',
          decimals: 6,
          symbol: 'USDT',
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
      amount: '45.9571',
      tokenSymbol: 'USDT',
    });
  });

  it('answers null for the empty object Tronscan sends for an unknown hash', async () => {
    const lookup = new HttpChainLookup({ fetch: answering({}) });

    await expect(
      lookup.find({ chain: 'tron', hash: TRON_HASH }),
    ).resolves.toBeNull();
  });
});
