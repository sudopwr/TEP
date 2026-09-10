/** What the store knows about a file once it has been written. */
export interface StoredFile {
  /** Path relative to `data/files`, matching `documents.stored_path`. */
  readonly storedPath: string;
  /** Lowercase hex SHA-256 of the bytes. Computed by the adapter. */
  readonly sha256: string;
  readonly byteSize: number;
}

/**
 * Content-addressed file storage under `data/files`.
 *
 * The store hashes, because hashing is `node:crypto` and core has no
 * dependencies. UC4 dedupes on the hash the store hands back: `put` the
 * bytes, then look for an existing document with that sha256 before
 * inserting a new row.
 */
export interface DocumentStore {
  put(bytes: Uint8Array, filename: string): Promise<StoredFile>;

  read(storedPath: string): Promise<Uint8Array>;

  exists(storedPath: string): Promise<boolean>;

  /** Only safe once no `documents` row references the path. */
  remove(storedPath: string): Promise<void>;
}
