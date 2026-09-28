import {
  ChainLookupUnavailableError,
  type Chain,
  type ChainLookup,
  type ChainReference,
  type ChainTransfer,
} from '@payout/core';

/**
 * F29 — reads one transaction from a public explorer.
 *
 * **The only outbound call this application makes.** §1 says one machine and
 * `127.0.0.1`, and until now that was the whole truth: nothing here had ever
 * talked to anything. What changed is narrow and worth stating exactly — a
 * request goes out only when somebody pastes a link and asks for it, it
 * carries a transaction hash and nothing else (no payout, no amount, no
 * name), and it goes to one of four hosts written into this file.
 *
 * **It never fetches the link it was given.** `parseExplorerLink` has already
 * reduced that to a chain and a hash, and the URL below is built here from
 * constants. A lookup service that fetched user input would read the cloud
 * metadata endpoint, or a printer on the LAN, for anybody who asked.
 */

/** Where each chain is read, and what identifies it to the API. */
interface Source {
  readonly kind: 'etherscan' | 'tronscan';
  /** Etherscan's V2 API takes the chain as a number. */
  readonly chainId?: number;
}

const SOURCES: Readonly<Record<Chain, Source>> = {
  ethereum: { kind: 'etherscan', chainId: 1 },
  bsc: { kind: 'etherscan', chainId: 56 },
  polygon: { kind: 'etherscan', chainId: 137 },
  tron: { kind: 'tronscan' },
};

/** `transfer(address,uint256)` — the call a token send actually is. */
const ERC20_TRANSFER = '0xa9059cbb';

export interface ChainLookupConfig {
  /**
   * One key covers Ethereum, BSC and Polygon (Etherscan's V2 API).
   *
   * Absent is a supported state, not a broken one: the three fields stay
   * typeable and the interface says why the lookup is off.
   */
  readonly etherscanApiKey?: string | undefined;
  /** Overridable so a test can answer without the internet. */
  readonly etherscanBaseUrl?: string;
  readonly tronBaseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class HttpChainLookup implements ChainLookup {
  readonly #key: string | undefined;
  readonly #etherscan: string;
  readonly #tron: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: ChainLookupConfig = {}) {
    this.#key =
      config.etherscanApiKey === undefined || config.etherscanApiKey === ''
        ? undefined
        : config.etherscanApiKey;
    this.#etherscan =
      config.etherscanBaseUrl ?? 'https://api.etherscan.io/v2/api';
    this.#tron = config.tronBaseUrl ?? 'https://apilist.tronscanapi.com/api';
    this.#timeoutMs = config.timeoutMs ?? 8_000;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  canRead(reference: ChainReference): boolean {
    return (
      SOURCES[reference.chain].kind !== 'etherscan' || this.#key !== undefined
    );
  }

  async find(reference: ChainReference): Promise<ChainTransfer | null> {
    return SOURCES[reference.chain].kind === 'tronscan'
      ? this.#fromTronscan(reference)
      : this.#fromEtherscan(reference);
  }

  /**
   * Ethereum and its two lookalikes, through Etherscan's JSON-RPC proxy.
   *
   * One call, not two: `eth_getTransactionByHash` carries the sender, the
   * destination and the call data, and the call data is where a token
   * transfer hides its real recipient.
   */
  async #fromEtherscan(
    reference: ChainReference,
  ): Promise<ChainTransfer | null> {
    if (this.#key === undefined) {
      throw new ChainLookupUnavailableError(
        reference.chain,
        'no ETHERSCAN_API_KEY is set in .env.',
      );
    }

    const query = new URLSearchParams({
      chainid: String(SOURCES[reference.chain].chainId),
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: reference.hash,
      apikey: this.#key,
    });

    const body = await this.#read(
      `${this.#etherscan}?${query.toString()}`,
      reference.chain,
    );

    /*
      Two shapes of "no".

      A hash nobody has seen comes back as `result: null`, which is a
      not-found and the reader should check the link. A rate limit or a bad
      key comes back as `status: "0"` with the reason in `result`, which is
      this application's problem and says so differently.
    */
    if (isRateLimited(body)) {
      throw new ChainLookupUnavailableError(
        reference.chain,
        `the explorer answered '${String(body['result'] ?? body['message'])}'.`,
      );
    }

    const result = body['result'];
    if (result === null || result === undefined || typeof result !== 'object') {
      return null;
    }

    const transaction = result as Record<string, unknown>;
    const from = asString(transaction['from']);
    if (from === null) return null;

    const to = asString(transaction['to']);
    const recipient = recipientOf(asString(transaction['input']) ?? '');

    /*
      For a token send, `to` is the *contract*, not the person.

      This is the trap the whole feature would otherwise walk into: every
      USDT transfer on Ethereum has `to` = `0xdac17f…`, so a ledger filled
      from it would record the token contract as the destination wallet of
      every single transfer, consistently and wrongly.
    */
    return recipient === null
      ? { fromAddress: from, toAddress: to }
      : { fromAddress: from, toAddress: recipient, tokenContract: to };
  }

  /** Tron, where USDT actually moves between a wallet and an exchange. */
  async #fromTronscan(
    reference: ChainReference,
  ): Promise<ChainTransfer | null> {
    const body = await this.#read(
      `${this.#tron}/transaction-info?hash=${encodeURIComponent(reference.hash)}`,
      reference.chain,
    );

    // Tronscan answers `{}` for a hash it has never seen.
    if (asString(body['hash']) === null) return null;

    const token = Array.isArray(body['trc20TransferInfo'])
      ? (body['trc20TransferInfo'][0] as Record<string, unknown> | undefined)
      : undefined;

    if (token !== undefined) {
      const from = asString(token['from_address']);
      if (from !== null) {
        return {
          fromAddress: from,
          toAddress: asString(token['to_address']),
          tokenContract: asString(token['contract_address']),
        };
      }
    }

    const from = asString(body['ownerAddress']);
    if (from === null) return null;

    return { fromAddress: from, toAddress: asString(body['toAddress']) };
  }

  /**
   * One request, with a deadline, turned into JSON.
   *
   * Every failure becomes `ChainLookupUnavailableError`, because from the
   * reader's side they are one thing: the addresses could not be read and
   * can still be typed. The reason is carried so the message says which.
   */
  async #read(
    url: string,
    chain: Chain,
  ): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await this.#fetch(url, {
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
    } catch (error: unknown) {
      throw new ChainLookupUnavailableError(
        chain,
        error instanceof Error && error.name === 'TimeoutError'
          ? `the explorer did not answer within ${String(this.#timeoutMs / 1000)}s.`
          : 'the explorer could not be reached.',
      );
    }

    if (!response.ok) {
      throw new ChainLookupUnavailableError(
        chain,
        `the explorer answered ${String(response.status)}.`,
      );
    }

    try {
      const body: unknown = await response.json();

      if (typeof body !== 'object' || body === null) {
        throw new Error('not an object');
      }

      return body as Record<string, unknown>;
    } catch {
      throw new ChainLookupUnavailableError(
        chain,
        'the explorer answered something that was not JSON.',
      );
    }
  }
}

/**
 * The recipient inside a `transfer(address,uint256)` call, or null.
 *
 * The call data is the 4-byte method id, then the address right-padded into
 * 32 bytes, then the amount. Anything else — a swap, a multisend, a contract
 * this does not know — returns null, and the field is left for the reader
 * rather than filled with a guess.
 */
function recipientOf(input: string): string | null {
  if (!input.toLowerCase().startsWith(ERC20_TRANSFER)) return null;
  if (input.length < 10 + 64) return null;

  const word = input.slice(10, 10 + 64);
  const address = `0x${word.slice(24)}`;

  return /^0x[0-9a-f]{40}$/i.test(address) ? address.toLowerCase() : null;
}

function isRateLimited(body: Record<string, unknown>): boolean {
  return body['status'] === '0' || body['error'] !== undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
