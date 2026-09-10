import type { Document } from '../domain/document';
import type { DocumentRepository } from '../ports/document-repository';

export interface SearchDocumentsDependencies {
  readonly documents: DocumentRepository;
}

export interface SearchDocumentsCommand {
  readonly query: string;
}

/**
 * UC9 — full-text search across filenames and extracted text.
 *
 * Thin on purpose: the matching is FTS5's job, and putting a second opinion
 * in front of it would only make the two disagree. An empty query returns
 * nothing rather than everything.
 */
export class SearchDocuments {
  readonly #deps: SearchDocumentsDependencies;

  constructor(dependencies: SearchDocumentsDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: SearchDocumentsCommand): Promise<readonly Document[]> {
    if (command.query.trim().length === 0) {
      return [];
    }
    return this.#deps.documents.search(command.query);
  }
}
