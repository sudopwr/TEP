import type { Document } from '../domain/document';
import type {
  DocumentRepository,
  DocumentTarget,
} from '../ports/document-repository';

export interface ListDocumentsForDependencies {
  readonly documents: DocumentRepository;
}

export interface ListDocumentsForCommand {
  readonly target: DocumentTarget;
}

/**
 * F6's read side: what is attached to this company, payout or leg.
 *
 * A leg's documents already arrive with the trail (UC5 hangs them on their
 * node), so this exists for the two places the trail does not reach: a payout
 * as a whole, and a company. A payout-level document is the one covering the
 * whole award — the contract, the platform's own statement — and before this
 * there was no way to see that it was there.
 */
export class ListDocumentsFor {
  readonly #deps: ListDocumentsForDependencies;

  constructor(dependencies: ListDocumentsForDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: ListDocumentsForCommand,
  ): Promise<readonly Document[]> {
    return this.#deps.documents.listForTarget(command.target);
  }
}
