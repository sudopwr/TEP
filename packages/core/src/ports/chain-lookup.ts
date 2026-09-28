import type { ChainReference } from '../domain/chain-reference';

/**
 * The two ends of a transfer, as the chain records them (F29).
 *
 * `toAddress` is nullable because a transaction need not have one that means
 * anything to a reader — a contract deployment has none, and a call the
 * adapter cannot decode leaves it out rather than guessing. The interface
 * fills in what it is given and leaves the rest to be typed.
 */
export interface ChainTransfer {
  readonly fromAddress: string;
  readonly toAddress: string | null;
  /** The token contract the transfer went through, when it was a token. */
  readonly tokenContract?: string | null;
}

/**
 * Reads one transaction from a chain's explorer.
 *
 * A port because it is the one thing in this application that leaves the
 * machine (§1 says one machine, and until F29 that was the whole truth): a
 * fake is what keeps every test off the network, and "no explorer configured"
 * is a second implementation that answers null to everything.
 */
export interface ChainLookup {
  /**
   * The transfer, or null when the chain has never heard of that hash.
   *
   * Throws rather than returns null when the *lookup itself* failed — no key
   * configured, the explorer unreachable, a rate limit. The difference
   * matters to the reader: one means "check the link", the other means "try
   * again later, and type them in meanwhile".
   */
  find(reference: ChainReference): Promise<ChainTransfer | null>;

  /** False when nothing is configured, so the interface can say so early. */
  canRead(reference: ChainReference): boolean;
}
