import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { DocumentStore, StoredFile } from '@payout/core';

/**
 * Files on disk under `data/files`, addressed by content.
 *
 * The path is derived from the hash and fanned out two levels, so a directory
 * never fills with tens of thousands of siblings and identical bytes written
 * twice occupy one file. That is what lets UC4 dedupe without a cleanup step:
 * the second `put` of the same statement overwrites itself with itself.
 *
 * Hashing lives here because `node:crypto` does, and core has no dependencies.
 */
export class FileSystemDocumentStore implements DocumentStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async put(bytes: Uint8Array, filename: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = path.extname(filename);
    const storedPath = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}${extension}`;
    const absolute = this.#resolve(storedPath);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);

    return { storedPath, sha256, byteSize: bytes.byteLength };
  }

  async read(storedPath: string): Promise<Uint8Array> {
    const buffer = await readFile(this.#resolve(storedPath));
    return new Uint8Array(buffer);
  }

  async exists(storedPath: string): Promise<boolean> {
    try {
      await stat(this.#resolve(storedPath));
      return true;
    } catch {
      return false;
    }
  }

  async remove(storedPath: string): Promise<void> {
    await rm(this.#resolve(storedPath), { force: true });
  }

  /**
   * A stream of the file's bytes, for serving it without buffering it.
   *
   * Beyond the `DocumentStore` port on purpose: a `Readable` is `node:stream`,
   * and core imports nothing. `DocumentFileSource` in `decorators.ts` names
   * the shape this satisfies, so the route can stream without knowing a
   * filesystem exists.
   *
   * The same `#resolve` guard applies, so a `stored_path` that has been
   * tampered with cannot walk out of the store — which matters more here than
   * anywhere else, since this one ends up on a socket.
   */
  openReadStream(storedPath: string): Readable {
    return createReadStream(this.#resolve(storedPath));
  }

  /**
   * Keep every path inside the root.
   *
   * `storedPath` comes from the database rather than from a user today, but a
   * store that will happily read `../../etc/passwd` because of where its input
   * came from is one refactor away from being a hole.
   */
  #resolve(storedPath: string): string {
    const absolute = path.resolve(this.#root, storedPath);
    const root = path.resolve(this.#root);

    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`stored path '${storedPath}' escapes the file store`);
    }

    return absolute;
  }
}
