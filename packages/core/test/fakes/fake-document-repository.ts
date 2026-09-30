import { Document } from '../../src/domain/document';
import type { DocumentId } from '../../src/domain/ids';
import type {
  DocumentDraft,
  DocumentFilter,
  DocumentQuery,
  DocumentRepository,
  DocumentTarget,
} from '../../src/ports/document-repository';

interface StoredLink {
  readonly documentId: DocumentId;
  readonly target: DocumentTarget;
  readonly role: string | null;
}

const keyOf = (documentId: DocumentId, target: DocumentTarget): string =>
  `${documentId}:${target.kind}:${target.id}`;

/**
 * Where a document nobody dated sorts: at the top, as just-arrived.
 *
 * SQL orders the register by `COALESCE(doc_date, date(created_at))`, and this
 * fake has no clock — insertion order is its only sense of time. Treating an
 * undated row as today's is what that COALESCE does for anything uploaded
 * today, which in a test is everything, and the id then breaks the tie in the
 * same direction.
 */
const UNDATED = '9999-12-31';

export class FakeDocumentRepository implements DocumentRepository {
  readonly #rows = new Map<DocumentId, Document>();
  readonly #links = new Map<string, StoredLink>();
  #nextId = 1;

  seed(...documents: readonly Document[]): this {
    for (const document of documents) {
      this.#rows.set(document.id, document);
      this.#nextId = Math.max(this.#nextId, document.id + 1);
    }
    return this;
  }

  findById(id: DocumentId): Promise<Document | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  findBySha256(sha256: string): Promise<Document | null> {
    for (const document of this.#rows.values()) {
      if (document.sha256 === sha256) {
        return Promise.resolve(document);
      }
    }
    return Promise.resolve(null);
  }

  findByStoredPath(storedPath: string): Promise<Document | null> {
    for (const document of this.#rows.values()) {
      if (document.storedPath === storedPath) {
        return Promise.resolve(document);
      }
    }
    return Promise.resolve(null);
  }

  insert(draft: DocumentDraft): Promise<Document> {
    const document = Document.create({ ...draft, id: this.#nextId });
    this.#nextId += 1;
    this.#rows.set(document.id, document);
    return Promise.resolve(document);
  }

  update(document: Document): Promise<Document> {
    this.#rows.set(document.id, document);
    return Promise.resolve(document);
  }

  /** Idempotent, matching the partial unique indexes on document_links. */
  link(
    documentId: DocumentId,
    target: DocumentTarget,
    role: string | null,
  ): Promise<void> {
    this.#links.set(keyOf(documentId, target), { documentId, target, role });
    return Promise.resolve();
  }

  unlink(documentId: DocumentId, target: DocumentTarget): Promise<void> {
    this.#links.delete(keyOf(documentId, target));
    return Promise.resolve();
  }

  countLinks(documentId: DocumentId): Promise<number> {
    return Promise.resolve(
      [...this.#links.values()].filter((link) => link.documentId === documentId)
        .length,
    );
  }

  /** The row and its links, as `ON DELETE CASCADE` does it in SQLite. */
  delete(documentId: DocumentId): Promise<void> {
    this.#rows.delete(documentId);

    for (const [key, link] of [...this.#links.entries()]) {
      if (link.documentId === documentId) {
        this.#links.delete(key);
      }
    }

    return Promise.resolve();
  }

  listForTarget(target: DocumentTarget): Promise<readonly Document[]> {
    const documents: Document[] = [];

    for (const link of this.#links.values()) {
      if (link.target.kind !== target.kind || link.target.id !== target.id) {
        continue;
      }
      const document = this.#rows.get(link.documentId);
      if (document !== undefined) {
        documents.push(document);
      }
    }

    return Promise.resolve(documents);
  }

  /**
   * The register, newest first (UC27), with the same ordering SQL uses:
   * the document's own date, the upload standing in when it has none.
   */
  list(query: DocumentQuery): Promise<readonly Document[]> {
    const matching = this.#matching(query.search);

    return Promise.resolve(
      matching.slice(query.offset, query.offset + query.limit),
    );
  }

  count(filter: DocumentFilter): Promise<number> {
    return Promise.resolve(this.#matching(filter.search).length);
  }

  /** Filtered and ordered, which both of the two above need. */
  #matching(search: string | undefined): readonly Document[] {
    const needle = (search ?? '').trim().toLowerCase();

    const rows = [...this.#rows.values()].filter(
      (document) =>
        needle === '' ||
        document.filename.toLowerCase().includes(needle) ||
        (document.extractedText ?? '').toLowerCase().includes(needle),
    );

    return rows.sort((one, other) => {
      const left = one.docDate ?? UNDATED;
      const right = other.docDate ?? UNDATED;

      // Newest first, and the id breaks a tie the way `ORDER BY … , id DESC`
      // does — two statements for the same month must not swap places
      // between one page and the next.
      return left === right ? other.id - one.id : right.localeCompare(left);
    });
  }

  /** A deliberately naive stand-in for FTS5: case-insensitive substring. */
  search(query: string): Promise<readonly Document[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      [...this.#rows.values()].filter(
        (document) =>
          document.filename.toLowerCase().includes(needle) ||
          (document.extractedText ?? '').toLowerCase().includes(needle),
      ),
    );
  }

  documentCount(): number {
    return this.#rows.size;
  }

  linkCount(): number {
    return this.#links.size;
  }

  links(): readonly StoredLink[] {
    return [...this.#links.values()];
  }
}
