import { createHash } from 'node:crypto';

import type { DocumentStore, StoredFile } from '../../src/ports/document-store';

/**
 * A content-addressed store backed by a Map.
 *
 * The path is derived from the hash, so writing identical bytes twice writes
 * one file — which is what makes UC4's dedupe observable: the second `put`
 * returns the same `storedPath` and the same `sha256`, and the store still
 * holds exactly one entry.
 *
 * This is the one place in the core package that hashes. Core cannot, having
 * no dependencies; a real adapter can, and so can its stand-in.
 */
export class FakeDocumentStore implements DocumentStore {
  readonly #files = new Map<string, Uint8Array>();

  put(bytes: Uint8Array, filename: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.'))
      : '';
    const storedPath = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}${extension}`;

    this.#files.set(storedPath, Uint8Array.from(bytes));

    return Promise.resolve({
      storedPath,
      sha256,
      byteSize: bytes.byteLength,
    });
  }

  read(storedPath: string): Promise<Uint8Array> {
    const bytes = this.#files.get(storedPath);
    if (bytes === undefined) {
      return Promise.reject(new Error(`no file stored at '${storedPath}'`));
    }
    return Promise.resolve(Uint8Array.from(bytes));
  }

  exists(storedPath: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(storedPath));
  }

  remove(storedPath: string): Promise<void> {
    this.#files.delete(storedPath);
    return Promise.resolve();
  }

  /** How many distinct files are held. One per distinct content. */
  size(): number {
    return this.#files.size;
  }

  paths(): readonly string[] {
    return [...this.#files.keys()];
  }
}
