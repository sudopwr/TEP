import type { Document, DocumentProps } from '../domain/document';
import type {
  CompanyId,
  DocumentId,
  PayoutId,
  TransactionId,
} from '../domain/ids';

export type DocumentDraft = Omit<DocumentProps, 'id'>;

/**
 * What a document is attached to — exactly one thing per link, mirroring the
 * three nullable FKs and the CHECK that sums to 1 in `document_links`.
 */
export type DocumentTarget =
  | { readonly kind: 'company'; readonly id: CompanyId }
  | { readonly kind: 'payout'; readonly id: PayoutId }
  | { readonly kind: 'transaction'; readonly id: TransactionId };

export interface DocumentRepository {
  findById(id: DocumentId): Promise<Document | null>;

  /** The dedupe lookup: same bytes, same row (UC4). */
  findBySha256(sha256: string): Promise<Document | null>;

  /**
   * The other unique handle on a document. UC4 dedupes on content, but the
   * legacy import has only filenames, so it keys on the path it derives from
   * one — which is what makes a second import a no-op rather than a
   * duplicate.
   */
  findByStoredPath(storedPath: string): Promise<Document | null>;

  insert(draft: DocumentDraft): Promise<Document>;

  update(document: Document): Promise<Document>;

  /** Idempotent: linking the same document to the same target twice is one
   *  link, not two. */
  link(
    documentId: DocumentId,
    target: DocumentTarget,
    role: string | null,
  ): Promise<void>;

  unlink(documentId: DocumentId, target: DocumentTarget): Promise<void>;

  listForTarget(target: DocumentTarget): Promise<readonly Document[]>;

  /** How many things this document is evidence for. Zero after the last
   *  unlink, which is a document nothing points at rather than a deleted one. */
  countLinks(documentId: DocumentId): Promise<number>;

  /**
   * Remove the document row and every link to it — never the file.
   *
   * The bytes are the caller's to remove afterwards and not before: a row
   * pointing at a file that is gone answers `DocumentFileMissingError` to
   * anyone who opens it, while a file no row points at is a few unreferenced
   * kilobytes in a content-addressed store. `DeleteDocument` orders the two.
   */
  delete(documentId: DocumentId): Promise<void>;

  /** Full-text search over filename and extracted text (UC9, FTS5). */
  search(query: string): Promise<readonly Document[]>;
}
