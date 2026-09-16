import { Document } from '../../src/domain/document';
import type { DocumentId } from '../../src/domain/ids';
import type {
  DocumentDraft,
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
