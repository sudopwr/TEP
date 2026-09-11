import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { FileSystemDocumentStore } from './filesystem-document-store';

const STATEMENT = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const OTHER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);

describe('FileSystemDocumentStore', () => {
  let root: string;
  let store: FileSystemDocumentStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'payout-store-test-'));
    store = new FileSystemDocumentStore(root);
  });

  it('writes the bytes and reports their hash and size', async () => {
    const stored = await store.put(STATEMENT, 'march.pdf');

    expect(stored.sha256).toBe(
      createHash('sha256').update(STATEMENT).digest('hex'),
    );
    expect(stored.byteSize).toBe(STATEMENT.byteLength);
    await expect(store.exists(stored.storedPath)).resolves.toBe(true);
  });

  it('reads back exactly what it wrote', async () => {
    const stored = await store.put(STATEMENT, 'march.pdf');

    await expect(store.read(stored.storedPath)).resolves.toEqual(STATEMENT);
  });

  it('addresses by content, so the path is the hash', async () => {
    const stored = await store.put(STATEMENT, 'march.pdf');

    expect(stored.storedPath).toBe(
      `${stored.sha256.slice(0, 2)}/${stored.sha256.slice(2, 4)}/${stored.sha256}.pdf`,
    );
  });

  it('gives identical bytes one path, whatever they are called', async () => {
    const first = await store.put(STATEMENT, 'march.pdf');
    const second = await store.put(STATEMENT, 'a-different-name.pdf');

    expect(second.storedPath).toBe(first.storedPath);
    expect(second.sha256).toBe(first.sha256);
  });

  it('gives different bytes different paths', async () => {
    const first = await store.put(STATEMENT, 'march.pdf');
    const second = await store.put(OTHER, 'march.pdf');

    expect(second.storedPath).not.toBe(first.storedPath);
  });

  it('keeps an extensionless name extensionless', async () => {
    const stored = await store.put(STATEMENT, 'statement');

    expect(path.extname(stored.storedPath)).toBe('');
  });

  it('reports a missing file as absent rather than throwing', async () => {
    await expect(store.exists('00/11/nothing.pdf')).resolves.toBe(false);
  });

  it('fails loudly when reading something that is not there', async () => {
    await expect(store.read('00/11/nothing.pdf')).rejects.toThrow();
  });

  it('removes a file, and removing it twice is not an error', async () => {
    const stored = await store.put(STATEMENT, 'march.pdf');

    await store.remove(stored.storedPath);
    await expect(store.exists(stored.storedPath)).resolves.toBe(false);
    await expect(store.remove(stored.storedPath)).resolves.toBeUndefined();
  });

  it('refuses a path that climbs out of the store', async () => {
    await expect(store.read('../../../etc/passwd')).rejects.toThrow(
      /escapes the file store/,
    );
  });
});
