import type { Document, DocumentType } from '../domain/document';
import type { IsoDate } from '../domain/ids';
import type {
  DocumentRepository,
  DocumentTarget,
} from '../ports/document-repository';
import type { DocumentStore } from '../ports/document-store';

export interface AttachDocumentDependencies {
  readonly documents: DocumentRepository;
  readonly store: DocumentStore;
}

export interface AttachDocumentCommand {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly target: DocumentTarget;
  readonly mimeType?: string | null;
  readonly docType?: DocumentType | null;
  readonly docDate?: IsoDate | null;
  readonly extractedText?: string | null;
  readonly role?: string | null;
}

export interface DocumentAttached {
  readonly document: Document;
  /** False when the bytes were already on file and only a link was added. */
  readonly created: boolean;
}

/**
 * UC4 — attach a file to a company, payout, or transaction.
 *
 * Identity is the content hash, not the filename: the same statement saved
 * under two names is one document with two links, and re-uploading it to a
 * second payout adds a link rather than a row. The store is
 * content-addressed, so the duplicate bytes do not occupy a second file
 * either — there is nothing to clean up.
 */
export class AttachDocument {
  readonly #deps: AttachDocumentDependencies;

  constructor(dependencies: AttachDocumentDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: AttachDocumentCommand): Promise<DocumentAttached> {
    const { documents, store } = this.#deps;
    const role = command.role ?? null;

    const stored = await store.put(command.bytes, command.filename);
    const existing = await documents.findBySha256(stored.sha256);

    if (existing !== null) {
      await documents.link(existing.id, command.target, role);
      return { document: existing, created: false };
    }

    const document = await documents.insert({
      filename: command.filename,
      storedPath: stored.storedPath,
      mimeType: command.mimeType ?? null,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      docType: command.docType ?? null,
      docDate: command.docDate ?? null,
      extractedText: command.extractedText ?? null,
    });

    await documents.link(document.id, command.target, role);

    return { document, created: true };
  }
}
