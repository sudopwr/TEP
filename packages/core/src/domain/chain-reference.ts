/**
 * F29 — what a pasted explorer link points at: a chain, and a hash.
 *
 * Pure parsing, no network. This is the half of the lookup that decides
 * *whether* anything may be fetched at all, which is why it lives in the
 * domain rather than beside the HTTP client: the adapter never sees the URL
 * the reader pasted. It is handed a chain and a hash, and builds its own
 * request to an address this file already approved.
 *
 * That inversion is the whole security argument. A server that fetched what
 * it was given would happily fetch `http://169.254.169.254/` or a machine on
 * the LAN; this one cannot, because the only URLs it can construct are the
 * ones in `EXPLORERS`.
 */

/** The chains an explorer link can be read for. */
export const CHAINS = ['ethereum', 'bsc', 'polygon', 'tron'] as const;

export type Chain = (typeof CHAINS)[number];

export interface ChainReference {
  readonly chain: Chain;
  /** The transaction hash, as the chain writes it. */
  readonly hash: string;
}

interface Explorer {
  readonly chain: Chain;
  /** Hosts that serve this chain's explorer, `www.` stripped. */
  readonly hosts: readonly string[];
  /** What a hash looks like there, anchored. */
  readonly hash: RegExp;
  /** The canonical page for one transaction, built from the first host. */
  readonly link: (hash: string) => string;
}

/*
  The four this ledger actually meets.

  Etherscan is the example in the request; BSC and Polygon are the same
  software on the same API and cost nothing to include. Tron is where USDT
  moves between a wallet and an Indian exchange, which is §10's own route —
  leaving it out would mean the feature did not work for the trail it was
  asked for.
*/
const EXPLORERS: readonly Explorer[] = [
  {
    chain: 'ethereum',
    hosts: ['etherscan.io', 'eth.blockscout.com'],
    hash: /^0x[0-9a-f]{64}$/i,
    link: (hash) => `https://etherscan.io/tx/${hash}`,
  },
  {
    chain: 'bsc',
    hosts: ['bscscan.com'],
    hash: /^0x[0-9a-f]{64}$/i,
    link: (hash) => `https://bscscan.com/tx/${hash}`,
  },
  {
    chain: 'polygon',
    hosts: ['polygonscan.com'],
    hash: /^0x[0-9a-f]{64}$/i,
    link: (hash) => `https://polygonscan.com/tx/${hash}`,
  },
  {
    chain: 'tron',
    hosts: ['tronscan.org', 'tronscan.io'],
    // Tron writes a hash as 64 hex characters with no `0x`.
    hash: /^[0-9a-f]{64}$/i,
    link: (hash) => `https://tronscan.org/#/transaction/${hash}`,
  },
];

/**
 * The chain and hash a link points at, or null if this is not one we read.
 *
 * Tolerant about the shape of the path and strict about everything else. A
 * link copied out of a browser can arrive as `…/tx//0xabc` (a doubled slash
 * — the example in the request is one), with a query string, with a trailing
 * slash, or as a Tronscan hash-route like `#/transaction/<hash>`. None of
 * that changes what it points at, so all of it is accepted; a host that is
 * not an explorer, or a hash that is not a hash, returns null and nothing is
 * fetched.
 */
export function parseExplorerLink(link: string): ChainReference | null {
  /*
    Split by hand rather than with `URL`.

    N3 keeps this package free of dependencies, and `URL` is declared by
    `@types/node` or by the DOM lib — pulling either in to read a string
    would put `node:fs` within reach of the domain. The shape being parsed is
    `scheme://host/rest`, which is three groups.
  */
  const parts = /^(https?):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i.exec(link.trim());
  if (parts === null) return null;

  const host = (parts[2] ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');

  const explorer = EXPLORERS.find((one) => one.hosts.includes(host));
  if (explorer === undefined) return null;

  /*
    Every piece of the rest, however it was separated.

    A hash turns up in a path (`/tx/0xabc`), in a Tronscan fragment route
    (`#/transaction/abc`) and occasionally in a query (`?txhash=abc`), and a
    link copied out of a browser can carry a doubled slash — the example in
    the request does. Splitting on all of the separators and ignoring the
    empty pieces makes every one of those the same input.
  */
  const hash = (parts[3] ?? '')
    .split(/[/?#&=]/)
    .find((piece) => explorer.hash.test(piece));

  if (hash === undefined) return null;

  return { chain: explorer.chain, hash: hash.toLowerCase() };
}

/**
 * What a pasted *hash* could be, in the order worth trying (F29).
 *
 * A hash carries no chain. `0x` and 64 hex is Ethereum's shape, and also
 * BSC's and Polygon's — they are the same chain software — so all three are
 * candidates and the lookup takes the first that has heard of it. Tron
 * writes the same 32 bytes without the `0x`, which is unambiguous.
 *
 * Costing up to three requests on a miss is the trade for letting somebody
 * paste the hash their exchange gave them without first working out which
 * chain their own withdrawal went over.
 */
export function parseChainHash(input: string): readonly ChainReference[] {
  const hash = input.trim().toLowerCase();

  return EXPLORERS.filter((explorer) => explorer.hash.test(hash)).map(
    (explorer) => ({ chain: explorer.chain, hash }),
  );
}

/**
 * Everything a pasted string could point at: a link resolves to one chain,
 * a bare hash to as many as share its shape, and anything else to none.
 */
export function parseChainCandidates(
  input: string,
): readonly ChainReference[] {
  const link = parseExplorerLink(input);

  return link === null ? parseChainHash(input) : [link];
}

/**
 * The canonical page for a transaction — what a bare hash is worth once the
 * chain is known.
 *
 * This is what gets stored: `explorer_url` is rendered as an anchor and the
 * edge only takes http(s), so a hash typed into that field would be refused
 * on save. Handing back a real link instead means typing a hash produces
 * both addresses *and* something a reader can click a year later.
 */
export function explorerUrlFor(reference: ChainReference): string {
  const explorer = EXPLORERS.find((one) => one.chain === reference.chain);

  if (explorer === undefined) {
    throw new Error(`no explorer is known for ${reference.chain}`);
  }

  return explorer.link(reference.hash);
}

/** Every host a link may name, for the message that says what is supported. */
export function explorerHosts(): readonly string[] {
  return EXPLORERS.flatMap((explorer) => explorer.hosts);
}
