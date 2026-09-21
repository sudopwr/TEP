import type { Document } from '../domain/document';
import { DocumentNotFoundError } from '../domain/errors';
import type { DocumentId } from '../domain/ids';
import type {
  DocumentRepository,
  DocumentTarget,
} from '../ports/document-repository';

export interface DetachDocumentDependencies {
  readonly documents: DocumentRepository;
}

export interface DetachDocumentCommand {
  readonly documentId: DocumentId;
  readonly target: DocumentTarget;
}

export interface DocumentDetached {
  readonly document: Document;
  /**
   * What the document is still evidence for. Zero is not a deleted document
   * — it is a file on record that nothing points at, which the Documents
   * screen can still find, re-attach, or delete outright (F22).
   */
  readonly remainingLinks: number;
}

/**
 * F23 — take a document off one thing, and leave it on file.
 *
 * The opposite end of `DeleteDocument`, and the distinction is the whole
 * point of having both. Deleting says *this file should not exist*: the row,
 * every attachment and the bytes go. Detaching says *this file is not
 * evidence for this leg* — a statement filed against the wrong sale — and the
 * file stays exactly where it is, ready to be attached to the right one.
 *
 * Idempotent, like the DELETE it serves: detaching something that is already
 * detached is the state the caller asked for. It reports what the document is
 * still attached to, so the reader can be told the difference between "off
 * this leg, still on two others" and "off the last thing that pointed at it".
 */
export class DetachDocument {
  readonly #deps: DetachDocumentDependencies;

  constructor(dependencies: DetachDocumentDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: DetachDocumentCommand): Promise<DocumentDetached> {
    const { documents } = this.#deps;

    const document = await documents.findById(command.documentId);
    if (document === null) {
      throw new DocumentNotFoundError(command.documentId);
    }

    await documents.unlink(document.id, command.target);

    return {
      document,
      remainingLinks: await documents.countLinks(document.id),
    };
  }
}
