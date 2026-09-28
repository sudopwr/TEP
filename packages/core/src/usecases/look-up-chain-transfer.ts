import {
  explorerHosts,
  explorerUrlFor,
  parseChainCandidates,
  type Chain,
} from '../domain/chain-reference';
import {
  ChainTransferNotFoundError,
  UnsupportedExplorerError,
} from '../domain/errors';
import type { ChainLookup, ChainTransfer } from '../ports/chain-lookup';

export interface LookUpChainTransferDependencies {
  readonly chain: ChainLookup;
}

export interface LookUpChainTransferCommand {
  /**
   * What was pasted: a link, doubled slashes and all, or a bare hash.
   *
   * Still called `link` because that is the field it comes from and what it
   * usually is; a hash is the shortcut for somebody whose exchange gave them
   * one without a page to go with it.
   */
  readonly link: string;
}

export interface ChainTransferFound extends ChainTransfer {
  readonly chain: Chain;
  readonly hash: string;
  /**
   * The canonical explorer page, whatever was pasted.
   *
   * A bare hash comes back with a link built for it, which is what the form
   * then stores: `explorer_url` is rendered as an anchor and the edge takes
   * only http(s), so a hash in that column would be refused on save.
   */
  readonly explorerUrl: string;
}

/**
 * UC26 — read the two ends of a transfer off its explorer link (F29).
 *
 * Typing a wallet address by hand is how a ledger ends up with an address
 * that is *almost* right, and an address that is almost right is worse than
 * none: it looks checkable and is not. The link is already in the clipboard
 * of anybody who has just made the transfer, and the chain knows who sent
 * and who received.
 *
 * What comes back is a **suggestion**. The interface fills the two fields
 * with it and leaves them editable, because an exchange withdrawal can move
 * through a contract this cannot decode, and the reader is the one who knows
 * which wallet was theirs.
 *
 * The parse happens here and the fetch happens behind the port, in that
 * order, so the adapter is never handed the pasted string: it receives a
 * chain this file recognised and a hash that matched that chain's shape.
 */
export class LookUpChainTransfer {
  readonly #deps: LookUpChainTransferDependencies;

  constructor(dependencies: LookUpChainTransferDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: LookUpChainTransferCommand,
  ): Promise<ChainTransferFound> {
    const { chain } = this.#deps;
    const candidates = parseChainCandidates(command.link);

    if (candidates.length === 0) {
      throw new UnsupportedExplorerError(explorerHosts());
    }

    /*
      A link names its chain; a bare hash does not, so each chain that could
      have produced it is asked in turn and the first that has heard of it
      wins. A chain that cannot be read at all — no key — is skipped rather
      than failed on, so a Tron hash still works with no Etherscan key, and
      the error only surfaces if *nothing* could be tried.
    */
    const readable = candidates.filter((one) => chain.canRead(one));

    if (readable.length === 0) {
      // One that cannot be read, asked anyway, so the port's own reason
      // reaches the reader instead of a sentence invented here.
      await chain.find(candidates[0] as (typeof candidates)[number]);
      throw new ChainTransferNotFoundError(
        candidates[0]?.chain ?? 'the chain',
        command.link,
      );
    }

    for (const reference of readable) {
      const transfer = await chain.find(reference);

      if (transfer !== null) {
        return {
          ...transfer,
          chain: reference.chain,
          hash: reference.hash,
          explorerUrl: explorerUrlFor(reference),
        };
      }
    }

    throw new ChainTransferNotFoundError(
      readable.map((one) => one.chain).join(', '),
      readable[0]?.hash ?? command.link,
    );
  }
}
