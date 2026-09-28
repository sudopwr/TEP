import { describe, expect, it, vi } from 'vitest';

import {
  explorerUrlFor,
  parseChainCandidates,
  parseExplorerLink,
} from '../domain/chain-reference';
import {
  ChainTransferNotFoundError,
  UnsupportedExplorerError,
} from '../domain/errors';
import type { ChainLookup, ChainTransfer } from '../ports/chain-lookup';

import { LookUpChainTransfer } from './look-up-chain-transfer';

/**
 * F29 — the two ends of a transfer, read off its explorer link.
 *
 * The parse is the security boundary as much as the convenience: the adapter
 * is never handed the pasted string, so a link naming a machine on the LAN
 * is refused here rather than fetched there. Half of these are about what is
 * *not* read.
 */

/** The exact link from the request, doubled slash and all. */
const PASTED =
  'https://etherscan.io/tx//0xe167419f8be1f9383aae00ca0508b1c85cf0a0cf31c187d38ecf18e53fcc7a94';

const HASH =
  '0xe167419f8be1f9383aae00ca0508b1c85cf0a0cf31c187d38ecf18e53fcc7a94';

/** What the port answers with, and a port that answers with it. */
const found: ChainTransfer = {
  fromAddress: '0x1111111111111111111111111111111111111111',
  toAddress: '0x2222222222222222222222222222222222222222',
  tokenContract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
};

const lookup = (overrides: Partial<ChainLookup> = {}): ChainLookup => ({
  find: vi.fn().mockResolvedValue(found),
  canRead: () => true,
  ...overrides,
});

describe('parseExplorerLink', () => {
  it('reads the link as pasted, doubled slash included', () => {
    expect(parseExplorerLink(PASTED)).toEqual({
      chain: 'ethereum',
      hash: HASH,
    });
  });

  it('reads the ordinary shapes too', () => {
    const shapes = [
      `https://etherscan.io/tx/${HASH}`,
      `https://www.etherscan.io/tx/${HASH}/`,
      `https://etherscan.io/tx/${HASH}?chainId=1`,
      `  https://etherscan.io/tx/${HASH}  `,
      `https://etherscan.io/tx/${HASH.toUpperCase()}`,
    ];

    for (const shape of shapes) {
      expect(parseExplorerLink(shape)).toEqual({
        chain: 'ethereum',
        hash: HASH,
      });
    }
  });

  it('knows the other three chains this ledger meets', () => {
    const tron = 'a'.repeat(64);

    expect(parseExplorerLink(`https://bscscan.com/tx/${HASH}`)?.chain).toBe(
      'bsc',
    );
    expect(
      parseExplorerLink(`https://polygonscan.com/tx/${HASH}`)?.chain,
    ).toBe('polygon');
    // Tronscan puts the route in the fragment and writes no `0x`.
    expect(
      parseExplorerLink(`https://tronscan.org/#/transaction/${tron}`),
    ).toEqual({ chain: 'tron', hash: tron });
  });

  it('refuses a host it does not know, however plausible', () => {
    expect(parseExplorerLink(`https://etherscan.io.evil.test/tx/${HASH}`)).toBeNull();
    expect(parseExplorerLink(`https://notetherscan.io/tx/${HASH}`)).toBeNull();
    expect(parseExplorerLink(`https://example.com/tx/${HASH}`)).toBeNull();
  });

  it('refuses what would make the server fetch something else entirely', () => {
    // The reason the parse exists. A server that fetched what it was handed
    // would read the cloud metadata service for anybody who asked.
    const attempts = [
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      `javascript:fetch('https://etherscan.io/tx/${HASH}')`,
      `https://192.168.1.1/tx/${HASH}`,
      `https://etherscan.io@evil.test/tx/${HASH}`,
      '',
      'etherscan.io/tx/' + HASH,
    ];

    for (const attempt of attempts) {
      expect(parseExplorerLink(attempt)).toBeNull();
    }
  });

  it('refuses a link with no hash on it, and one that is the wrong shape', () => {
    expect(parseExplorerLink('https://etherscan.io/')).toBeNull();
    expect(parseExplorerLink('https://etherscan.io/tx/0xabc')).toBeNull();
    // 64 hex with no `0x` is a Tron hash, not an Ethereum one.
    expect(parseExplorerLink(`https://etherscan.io/tx/${'a'.repeat(64)}`)).toBeNull();
  });
});

describe('LookUpChainTransfer (UC26)', () => {
  it('answers with both ends and what was read', async () => {
    const chain = lookup();
    const useCase = new LookUpChainTransfer({ chain });

    const transfer = await useCase.execute({ link: PASTED });

    expect(transfer).toMatchObject({
      chain: 'ethereum',
      hash: HASH,
      fromAddress: found.fromAddress,
      toAddress: found.toAddress,
    });
  });

  it('hands the port a chain and a hash, never the pasted string', async () => {
    // The inversion the whole design rests on: the adapter builds its own
    // request to an address the domain already approved.
    const find = vi.fn().mockResolvedValue(found);
    const useCase = new LookUpChainTransfer({ chain: lookup({ find }) });

    await useCase.execute({ link: PASTED });

    expect(find).toHaveBeenCalledWith({ chain: 'ethereum', hash: HASH });
    expect(JSON.stringify(find.mock.calls)).not.toContain('//0x');
  });

  it('refuses a link it cannot read, and names what it can', async () => {
    const find = vi.fn();
    const useCase = new LookUpChainTransfer({ chain: lookup({ find }) });

    await expect(
      useCase.execute({ link: 'https://example.com/tx/0xabc' }),
    ).rejects.toBeInstanceOf(UnsupportedExplorerError);
    // Nothing was fetched.
    expect(find).not.toHaveBeenCalled();
  });

  it('says so when the chain has no such transaction', async () => {
    const useCase = new LookUpChainTransfer({
      chain: lookup({ find: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ link: PASTED })).rejects.toBeInstanceOf(
      ChainTransferNotFoundError,
    );
  });

  it('lets a failure to read pass through as itself', async () => {
    // "Not found" means the link is wrong; a failure means try again. A
    // reader who cannot tell them apart retypes a link that was right.
    const boom = new Error('rate limited');
    const useCase = new LookUpChainTransfer({
      chain: lookup({ find: vi.fn().mockRejectedValue(boom) }),
    });

    await expect(useCase.execute({ link: PASTED })).rejects.toBe(boom);
  });

  it('passes on a transfer whose destination could not be decoded', async () => {
    // A withdrawal routed through a contract: the sender is known, the
    // recipient is not, and the form fills one field and leaves the other.
    const useCase = new LookUpChainTransfer({
      chain: lookup({
        find: vi
          .fn()
          .mockResolvedValue({ fromAddress: found.fromAddress, toAddress: null }),
      }),
    });

    const transfer = await useCase.execute({ link: PASTED });

    expect(transfer.fromAddress).toBe(found.fromAddress);
    expect(transfer.toAddress).toBeNull();
  });
});

describe('a bare transaction hash', () => {
  const TRON = 'a'.repeat(64);

  it('is enough, and could be any of the three chains that share its shape', () => {
    // A hash carries no chain. Ethereum, BSC and Polygon are the same chain
    // software and write hashes the same way, so all three are candidates.
    expect(parseChainCandidates(HASH).map((one) => one.chain)).toEqual([
      'ethereum',
      'bsc',
      'polygon',
    ]);
  });

  it('is unambiguous on Tron, which writes the same bytes without the 0x', () => {
    expect(parseChainCandidates(TRON)).toEqual([
      { chain: 'tron', hash: TRON },
    ]);
  });

  it('is accepted however it was copied', () => {
    for (const shape of [` ${HASH} `, HASH.toUpperCase()]) {
      expect(parseChainCandidates(shape)[0]).toEqual({
        chain: 'ethereum',
        hash: HASH,
      });
    }
  });

  it('is still refused when it is not a hash at all', () => {
    for (const nonsense of ['0xabc', 'the one from tuesday', '', '0x' + 'z'.repeat(64)]) {
      expect(parseChainCandidates(nonsense)).toEqual([]);
    }
  });

  it('has a canonical page, which is what gets stored', () => {
    expect(explorerUrlFor({ chain: 'ethereum', hash: HASH })).toBe(
      `https://etherscan.io/tx/${HASH}`,
    );
    expect(explorerUrlFor({ chain: 'tron', hash: TRON })).toBe(
      `https://tronscan.org/#/transaction/${TRON}`,
    );
  });

  it('is looked up chain by chain until one has heard of it', async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce(null) // ethereum has never seen it
      .mockResolvedValueOnce(found); // BSC has

    const useCase = new LookUpChainTransfer({ chain: lookup({ find }) });
    const transfer = await useCase.execute({ link: HASH });

    expect(transfer.chain).toBe('bsc');
    expect(transfer.explorerUrl).toBe(`https://bscscan.com/tx/${HASH}`);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('stops at the first chain that has it, rather than asking all three', async () => {
    const find = vi.fn().mockResolvedValue(found);
    const useCase = new LookUpChainTransfer({ chain: lookup({ find }) });

    await useCase.execute({ link: HASH });

    expect(find).toHaveBeenCalledOnce();
  });

  it('says not found only once every chain has been asked', async () => {
    const find = vi.fn().mockResolvedValue(null);
    const useCase = new LookUpChainTransfer({ chain: lookup({ find }) });

    await expect(useCase.execute({ link: HASH })).rejects.toThrow(
      /ethereum, bsc, polygon/,
    );
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('skips a chain it cannot read, so Tron works with no Etherscan key', async () => {
    const find = vi.fn().mockResolvedValue(found);
    const useCase = new LookUpChainTransfer({
      chain: lookup({ find, canRead: (one) => one.chain === 'tron' }),
    });

    const transfer = await useCase.execute({ link: TRON });

    expect(transfer.chain).toBe('tron');
    expect(find).toHaveBeenCalledOnce();
  });

  it('lets the port explain itself when nothing can be read at all', async () => {
    // No key: the reason belongs to the adapter, and inventing a sentence
    // here would hide "no ETHERSCAN_API_KEY is set".
    const boom = new Error('no ETHERSCAN_API_KEY is set in .env.');
    const useCase = new LookUpChainTransfer({
      chain: lookup({
        canRead: () => false,
        find: vi.fn().mockRejectedValue(boom),
      }),
    });

    await expect(useCase.execute({ link: HASH })).rejects.toBe(boom);
  });

  it('hands back the canonical page for a link too', async () => {
    const useCase = new LookUpChainTransfer({ chain: lookup() });

    const transfer = await useCase.execute({ link: PASTED });

    // The doubled slash does not survive into what gets stored.
    expect(transfer.explorerUrl).toBe(`https://etherscan.io/tx/${HASH}`);
  });
});
