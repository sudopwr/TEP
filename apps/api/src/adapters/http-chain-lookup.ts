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

/**
 * `Transfer(address indexed from, address indexed to, uint256 value)`.
 *
 * The event every ERC-20 emits, and what Etherscan prints under "ERC-20
 * Tokens Transferred". Reading this rather than the transaction's own `to`
 * is what makes a bridge, a router or an exchange's withdrawal contract come
 * out right: those have call data nothing here could decode, and a `to` that
 * is a proxy nobody holds money in.
 */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** `decimals()` and `symbol()`, so an amount can be written as a person reads it. */
const DECIMALS_CALL = '0x313ce567';
const SYMBOL_CALL = '0x95d89b41';

/** What each chain calls the gas it is paid in, for a transfer with no token. */
const NATIVE: Readonly<Record<Chain, string>> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  polygon: 'POL',
  tron: 'TRX',
};

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
  /** `chain:contract` -> what that token calls itself. Never changes. */
  readonly #tokens = new Map<
    string,
    { decimals: number | null; symbol: string | null }
  >();

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
   * Two calls, and the second is the one that matters. The transaction says
   * who signed and which contract they called; the *receipt* carries the
   * `Transfer` events, which is where the tokens actually moved. A bridge
   * like LayerZero has `to` = an upgradeable proxy and call data this could
   * never decode, while its receipt says plainly that 45.9571 USDT left one
   * address and arrived at another — the row Etherscan prints as "ERC-20
   * Tokens Transferred", and the one a ledger wants.
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

    const transaction = await this.#rpc(reference, 'eth_getTransactionByHash');

    if (transaction === null) return null;

    const signer = asString(transaction['from']);
    if (signer === null) return null;

    const receipt = await this.#rpc(reference, 'eth_getTransactionReceipt');
    const transfer = principalTransfer(receipt?.['logs']);

    if (transfer === null) {
      /*
        No token moved, so this was a plain send of the chain's own coin.
        The transaction's own two ends are then the right ones, and its
        `value` is the amount.
      */
      const value = asBigInt(transaction['value']);

      return {
        fromAddress: signer,
        toAddress: asString(transaction['to']),
        ...(value === null || value === 0n
          ? {}
          : {
              amount: formatUnits(value, 18),
              tokenSymbol: NATIVE[reference.chain],
            }),
      };
    }

    const token = await this.#tokenOf(reference, transfer.contract);

    return {
      // The transfer's own ends, not the transaction's: on a bridge the
      // signer is a relayer and `to` is a proxy, and neither is where the
      // money was.
      fromAddress: transfer.from,
      toAddress: transfer.to,
      tokenContract: transfer.contract,
      ...(token.decimals === null
        ? {}
        : { amount: formatUnits(transfer.value, token.decimals) }),
      ...(token.symbol === null ? {} : { tokenSymbol: token.symbol }),
    };
  }

  /** One JSON-RPC call through the proxy, or null when there is no such thing. */
  async #rpc(
    reference: ChainReference,
    action: 'eth_getTransactionByHash' | 'eth_getTransactionReceipt',
  ): Promise<Record<string, unknown> | null> {
    const query = new URLSearchParams({
      chainid: String(SOURCES[reference.chain].chainId),
      module: 'proxy',
      action,
      txhash: reference.hash,
      apikey: this.#key ?? '',
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

    return result === null || result === undefined || typeof result !== 'object'
      ? null
      : (result as Record<string, unknown>);
  }

  /**
   * What a token calls itself and how many decimals it keeps.
   *
   * Two `eth_call`s, cached for the life of the process: USDT is the same
   * six decimals every time, and asking again for every transfer would
   * spend somebody's rate limit on an answer that cannot change.
   *
   * Neither is guessed. §13's rule about scales applies here exactly — a
   * token read as 18 decimals when it keeps 6 is an amount a million million
   * times too large, and it would look perfectly reasonable in the field.
   * Unknown means the amount is simply not offered.
   */
  async #tokenOf(
    reference: ChainReference,
    contract: string,
  ): Promise<{ decimals: number | null; symbol: string | null }> {
    const key = `${reference.chain}:${contract.toLowerCase()}`;
    const known = this.#tokens.get(key);
    if (known !== undefined) return known;

    const [decimals, symbol] = await Promise.all([
      this.#call(reference, contract, DECIMALS_CALL),
      this.#call(reference, contract, SYMBOL_CALL),
    ]);

    const found = {
      decimals: decimalsFrom(decimals),
      symbol: symbolFrom(symbol),
    };

    this.#tokens.set(key, found);

    return found;
  }

  /** A constant call on a contract — `decimals()`, `symbol()`. */
  async #call(
    reference: ChainReference,
    contract: string,
    data: string,
  ): Promise<string | null> {
    const query = new URLSearchParams({
      chainid: String(SOURCES[reference.chain].chainId),
      module: 'proxy',
      action: 'eth_call',
      to: contract,
      data,
      tag: 'latest',
      apikey: this.#key ?? '',
    });

    try {
      const body = await this.#read(
        `${this.#etherscan}?${query.toString()}`,
        reference.chain,
      );

      return asString(body['result']);
    } catch {
      // A token that will not say — the addresses are still worth having,
      // and the amount is left for the reader.
      return null;
    }
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
        const raw = asBigInt(token['amount_str']);
        const decimals = decimalsOf(token['decimals']);

        return {
          fromAddress: from,
          toAddress: asString(token['to_address']),
          tokenContract: asString(token['contract_address']),
          ...(raw === null || decimals === null
            ? {}
            : { amount: formatUnits(raw, decimals) }),
          ...(asString(token['symbol']) === null
            ? {}
            : { tokenSymbol: asString(token['symbol']) }),
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

interface TokenMovement {
  readonly contract: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

/**
 * The token movement this transaction is *about*.
 *
 * A receipt can carry several `Transfer` events — a fee to a relayer, a
 * router's hop through an intermediate pool, a bridge's burn and mint. The
 * largest is the one a person means when they say what the transaction was,
 * which is the same thing Etherscan shows as "Net Transfers"; the rest are
 * plumbing. Ties go to the last, because that is the one the money ended on.
 *
 * ERC-721 emits the same event name with the token id as a third indexed
 * topic, so a log with four topics is a moved *picture* and not an amount.
 */
function principalTransfer(logs: unknown): TokenMovement | null {
  if (!Array.isArray(logs)) return null;

  let best: TokenMovement | null = null;

  for (const entry of logs) {
    if (typeof entry !== 'object' || entry === null) continue;

    const log = entry as Record<string, unknown>;
    const topics = log['topics'];

    if (!Array.isArray(topics) || topics.length !== 3) continue;
    if (asString(topics[0])?.toLowerCase() !== TRANSFER_TOPIC) continue;

    const from = addressFromTopic(topics[1]);
    const to = addressFromTopic(topics[2]);
    const contract = asString(log['address']);
    const value = asBigInt(log['data']);

    if (from === null || to === null || contract === null || value === null) {
      continue;
    }

    if (best === null || value >= best.value) {
      best = { contract: contract.toLowerCase(), from, to, value };
    }
  }

  return best;
}

/** A 32-byte topic holds an address in its last 20. */
function addressFromTopic(topic: unknown): string | null {
  const value = asString(topic);
  if (value === null || !/^0x[0-9a-f]{64}$/i.test(value)) return null;

  return `0x${value.slice(26)}`.toLowerCase();
}

/** `45957100` at 6 decimals reads `45.9571`, with no trailing noise. */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString();

  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');

  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** `decimals()` answers a uint256; anything absurd is treated as unknown. */
function decimalsFrom(result: string | null): number | null {
  const value = asBigInt(result);

  return value === null || value < 0n || value > 36n ? null : Number(value);
}

/** Tronscan writes the decimals as a number, and sometimes as a string. */
function decimalsOf(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36
    ? parsed
    : null;
}

/**
 * `symbol()`, which is a string on most tokens and a `bytes32` on the oldest.
 *
 * The dynamic form is an offset, a length and the bytes; the fixed form is
 * 32 bytes padded with zeros. Both are read, because MKR and a few others
 * still answer the old way and would otherwise come back as gibberish.
 */
function symbolFrom(result: string | null): string | null {
  if (result === null || !result.startsWith('0x')) return null;

  const body = result.slice(2);
  if (body.length === 0) return null;

  const text =
    body.length <= 64
      ? hexToText(body)
      : hexToText(body.slice(128, 128 + Number(BigInt(`0x${body.slice(64, 128)}`)) * 2));

  const cleaned = text.replace(/[^\x20-\x7e]/g, '').trim();

  return cleaned === '' || cleaned.length > 32 ? null : cleaned;
}

function hexToText(hex: string): string {
  let text = '';

  for (let at = 0; at + 1 < hex.length; at += 2) {
    const code = Number.parseInt(hex.slice(at, at + 2), 16);
    if (Number.isNaN(code) || code === 0) continue;
    text += String.fromCharCode(code);
  }

  return text;
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isRateLimited(body: Record<string, unknown>): boolean {
  return body['status'] === '0' || body['error'] !== undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
