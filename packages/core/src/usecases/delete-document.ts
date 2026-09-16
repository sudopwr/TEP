import type { Document } from '../domain/document';
import { DocumentNotFoundError } from '../domain/errors';
import type { DocumentId } from '../domain/ids';
import type { DocumentRepository } from '../ports/document-repository';
import type { DocumentStore } from '../ports/document-store';

export interface DeleteDocumentDependencies {
  readonly documents: DocumentRepository;
  readonly store: DocumentStore;
}

export interface DeleteDocumentCommand {
  readonly documentId: DocumentId;
}

export interface DocumentDeleted {
  /** The row as it was; there is nothing on file with that id afterwards. */
  readonly document: Document;
  /** How many things lost their evidence. One document may be several (F6). */
  readonly linksRemoved: number;
}

/**
 * F22 — delete a document: the row, every link to it, and the file.
 *
 * **Everywhere, not from one place.** F6 lets one file be evidence for
 * several things — a statement attached to the payout and to the sale it
 * settles — and a document is a *thing*, not a relationship. So deleting one
 * takes all of its attachments with it, and the count comes back so the
 * confirmation in front of the reader can say how many. Removing a single
 * attachment is a different act, and would be `unlink`.
 *
 * **The row first, the file second.** The reverse order fails in the
 * direction nobody can fix: a row pointing at bytes that are gone answers
 * `DocumentFileMissingError` (422) to anyone who opens it, and re-uploading
 * the same file would dedupe onto that broken row by hash. A file nothing
 * points at is a few unreferenced kilobytes in a content-addressed store, and
 * the next upload of those bytes simply writes them again.
 *
 * So a failure between the two leaves the store tidy and the ledger correct,
 * which is the only pairing of outcomes worth having. `DocumentStore.remove`
 * is deliberately forgiving about a file that has already gone: a document
 * whose bytes were lost is exactly the row somebody most wants to delete, and
 * refusing would strand it.
 */
export class DeleteDocument {
  readonly #deps: DeleteDocumentDependencies;

  constructor(dependencies: DeleteDocumentDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: DeleteDocumentCommand): Promise<DocumentDeleted> {
    const { documents, store } = this.#deps;

    const document = await documents.findById(command.documentId);
    if (document === null) {
      throw new DocumentNotFoundError(command.documentId);
    }

    const linksRemoved = await documents.countLinks(document.id);

    await documents.delete(document.id);
    await store.remove(document.storedPath);

    return { document, linksRemoved };
  }
}
