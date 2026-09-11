import type {
  Document,
  DocumentDraft,
  DocumentId,
  DocumentRepository,
  DocumentTarget,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toDocument, type DocumentRow } from './mappers';

const DOC_COLUMNS = `id, filename, stored_path, mime_type, byte_size,
  sha256, doc_type, doc_date, extracted_text`;

const DOC_COLUMNS_D = `d.id, d.filename, d.stored_path, d.mime_type, d.byte_size,
  d.sha256, d.doc_type, d.doc_date, d.extracted_text`;

const SQL = {
  selectById: `SELECT ${DOC_COLUMNS} FROM documents WHERE id = ?`,
  selectBySha: `SELECT ${DOC_COLUMNS} FROM documents WHERE sha256 = ?`,
  insert: `INSERT INTO documents
             (filename, stored_path, mime_type, byte_size, sha256, doc_type, doc_date, extracted_text)
           VALUES
             (@filename, @storedPath, @mimeType, @byteSize, @sha256, @docType, @docDate, @extractedText)`,
  update: `UPDATE documents SET
             filename = @filename, stored_path = @storedPath, mime_type = @mimeType,
             byte_size = @byteSize, sha256 = @sha256, doc_type = @docType,
             doc_date = @docDate, extracted_text = @extractedText
           WHERE id = @id`,

  /**
   * INSERT OR IGNORE leans on the three partial unique indexes, so linking a
   * document to the same target twice is one link. The first link's role wins;
   * re-linking is not a way to edit it.
   */
  linkCompany: `INSERT OR IGNORE INTO document_links (document_id, company_id, role) VALUES (?, ?, ?)`,
  linkPayout: `INSERT OR IGNORE INTO document_links (document_id, payout_id, role) VALUES (?, ?, ?)`,
  linkTransaction: `INSERT OR IGNORE INTO document_links (document_id, transaction_id, role) VALUES (?, ?, ?)`,

  unlinkCompany: `DELETE FROM document_links WHERE document_id = ? AND company_id = ?`,
  unlinkPayout: `DELETE FROM document_links WHERE document_id = ? AND payout_id = ?`,
  unlinkTransaction: `DELETE FROM document_links WHERE document_id = ? AND transaction_id = ?`,

  listForCompany: `SELECT ${DOC_COLUMNS_D} FROM documents d
                     JOIN document_links l ON l.document_id = d.id
                    WHERE l.company_id = ? ORDER BY l.id`,
  listForPayout: `SELECT ${DOC_COLUMNS_D} FROM documents d
                    JOIN document_links l ON l.document_id = d.id
                   WHERE l.payout_id = ? ORDER BY l.id`,
  listForTransaction: `SELECT ${DOC_COLUMNS_D} FROM documents d
                         JOIN document_links l ON l.document_id = d.id
                        WHERE l.transaction_id = ? ORDER BY l.id`,

  /** FTS5 over filename and extracted text, best match first. */
  search: `SELECT ${DOC_COLUMNS_D} FROM documents_fts
             JOIN documents d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH ?
            ORDER BY documents_fts.rank`,
} as const;

interface DocumentWrite {
  readonly filename: string;
  readonly storedPath: string;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly sha256: string;
  readonly docType: string | null;
  readonly docDate: string | null;
  readonly extractedText: string | null;
}

/**
 * Turn user text into a single FTS5 phrase.
 *
 * A raw query string is FTS5 syntax: a stray `*`, `"` or `AND` is either a
 * different search or a syntax error thrown at the user. Quoting the whole
 * thing as one phrase means a search box behaves like a search box.
 */
export function toFtsPhrase(query: string): string {
  return `"${query.trim().replace(/"/g, '""')}"`;
}

export class SqliteDocumentRepository implements DocumentRepository {
  readonly #selectById;
  readonly #selectBySha;
  readonly #insert;
  readonly #update;
  readonly #link;
  readonly #unlink;
  readonly #listFor;
  readonly #search;

  constructor(database: SqliteDatabase) {
    this.#selectById = database.prepare<[number], DocumentRow>(SQL.selectById);
    this.#selectBySha = database.prepare<[string], DocumentRow>(
      SQL.selectBySha,
    );
    this.#insert = database.prepare<DocumentWrite>(SQL.insert);
    this.#update = database.prepare<DocumentWrite & { id: number }>(SQL.update);

    this.#link = {
      company: database.prepare<[number, number, string | null]>(
        SQL.linkCompany,
      ),
      payout: database.prepare<[number, number, string | null]>(SQL.linkPayout),
      transaction: database.prepare<[number, number, string | null]>(
        SQL.linkTransaction,
      ),
    };

    this.#unlink = {
      company: database.prepare<[number, number]>(SQL.unlinkCompany),
      payout: database.prepare<[number, number]>(SQL.unlinkPayout),
      transaction: database.prepare<[number, number]>(SQL.unlinkTransaction),
    };

    this.#listFor = {
      company: database.prepare<[number], DocumentRow>(SQL.listForCompany),
      payout: database.prepare<[number], DocumentRow>(SQL.listForPayout),
      transaction: database.prepare<[number], DocumentRow>(
        SQL.listForTransaction,
      ),
    };

    this.#search = database.prepare<[string], DocumentRow>(SQL.search);
  }

  async findById(id: DocumentId): Promise<Document | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : toDocument(row));
  }

  async findBySha256(sha256: string): Promise<Document | null> {
    const row = this.#selectBySha.get(sha256);
    return Promise.resolve(row === undefined ? null : toDocument(row));
  }

  async insert(draft: DocumentDraft): Promise<Document> {
    const result = this.#insert.run(SqliteDocumentRepository.#toWrite(draft));
    return this.#require(Number(result.lastInsertRowid));
  }

  async update(document: Document): Promise<Document> {
    this.#update.run({
      ...SqliteDocumentRepository.#toWrite(document),
      id: document.id,
    });
    return this.#require(document.id);
  }

  async link(
    documentId: DocumentId,
    target: DocumentTarget,
    role: string | null,
  ): Promise<void> {
    this.#link[target.kind].run(documentId, target.id, role);
    return Promise.resolve();
  }

  async unlink(documentId: DocumentId, target: DocumentTarget): Promise<void> {
    this.#unlink[target.kind].run(documentId, target.id);
    return Promise.resolve();
  }

  async listForTarget(target: DocumentTarget): Promise<readonly Document[]> {
    return Promise.resolve(
      this.#listFor[target.kind].all(target.id).map(toDocument),
    );
  }

  async search(query: string): Promise<readonly Document[]> {
    if (query.trim().length === 0) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.#search.all(toFtsPhrase(query)).map(toDocument),
    );
  }

  static #toWrite(document: DocumentDraft | Document): DocumentWrite {
    return {
      filename: document.filename,
      storedPath: document.storedPath,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      docType: document.docType,
      docDate: document.docDate,
      extractedText: document.extractedText,
    };
  }

  async #require(id: DocumentId): Promise<Document> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`documents row ${String(id)} vanished after writing it`);
    }
    return Promise.resolve(toDocument(row));
  }
}
