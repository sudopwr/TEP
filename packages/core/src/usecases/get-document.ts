import type { Document } from '../domain/document';
import {
  DocumentFileMissingError,
  DocumentNotFoundError,
} from '../domain/errors';
import type { DocumentId } from '../domain/ids';
import type { DocumentRepository } from '../ports/document-repository';
import type { DocumentStore } from '../ports/document-store';

export interface GetDocumentDependencies {
  readonly documents: DocumentRepository;
  readonly store: DocumentStore;
}

export interface GetDocumentCommand {
  readonly documentId: DocumentId;
}

/**
 * F6's read side — the metadata needed to serve a file, and nothing more.
 *
 * Note what this does *not* return: the bytes. A document can be a 40MB
 * statement, and reading it into a Buffer to hand to a route would put the
 * whole thing in memory twice on the way out. The route streams it; this
 * says which file, how big, and what to call it.
 *
 * It does check the file is there, so a row pointing at a missing file is a
 * 404 with a sentence rather than a stream that dies half way through with
 * the status line already sent.
 */
export class GetDocument {
  readonly #deps: GetDocumentDependencies;

  constructor(dependencies: GetDocumentDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: GetDocumentCommand): Promise<Document> {
    const { documents, store } = this.#deps;

    const document = await documents.findById(command.documentId);
    if (document === null) {
      throw new DocumentNotFoundError(command.documentId);
    }

    if (!(await store.exists(document.storedPath))) {
      throw new DocumentFileMissingError(document.id, document.storedPath);
    }

    return document;
  }
}
