import type { Document } from '../domain/document';
import { DocumentNotFoundError } from '../domain/errors';
import type { DocumentId } from '../domain/ids';
import type {
  DocumentRepository,
  DocumentTarget,
} from '../ports/document-repository';

export interface LinkDocumentDependencies {
  readonly documents: DocumentRepository;
}

export interface LinkDocumentCommand {
  readonly documentId: DocumentId;
  readonly target: DocumentTarget;
  readonly role?: string | null;
}

/**
 * F23 — attach a document that is already on file to one more thing.
 *
 * The other half of UC4. Attaching arrives as bytes: hash them, dedupe, link.
 * But a file that is already stored has nothing to upload — the statement
 * covering four sales is attached to the first of them and then *chosen* for
 * the other three, and asking somebody to find the original file on disk and
 * upload it again to say so would be absurd.
 *
 * Idempotent, because `document_links` has a partial unique index per target
 * kind and the adapter inserts OR IGNORE: linking the same document to the
 * same leg twice is one link, and the first role wins. Re-linking is not a
 * way to edit the role.
 *
 * The target is checked by the database rather than here. Both foreign keys
 * are real, and §13 has the adapter translating the violation into a sentence
 * naming the side that was wrong — a second lookup would only be a race with
 * that one.
 */
export class LinkDocument {
  readonly #deps: LinkDocumentDependencies;

  constructor(dependencies: LinkDocumentDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: LinkDocumentCommand): Promise<Document> {
    const { documents } = this.#deps;

    const document = await documents.findById(command.documentId);
    if (document === null) {
      throw new DocumentNotFoundError(command.documentId);
    }

    await documents.link(document.id, command.target, command.role ?? null);

    return document;
  }
}
