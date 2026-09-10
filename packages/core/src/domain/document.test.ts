import { describe, expect, it } from 'vitest';

import { Document } from './document';

const HASH_A =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const HASH_B =
  '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d';

const statement = () =>
  Document.create({
    id: 1,
    filename: 'coindcx-march.pdf',
    storedPath: '9f/86/9f86d081.pdf',
    mimeType: 'application/pdf',
    byteSize: 20480,
    sha256: HASH_A,
    docType: 'statement',
    docDate: '2025-03-31',
    extractedText: null,
  });

describe('Document', () => {
  it('keeps the original filename and the stored path apart', () => {
    const document = statement();

    expect(document.filename).toBe('coindcx-march.pdf');
    expect(document.storedPath).toBe('9f/86/9f86d081.pdf');
    expect(document.docType).toBe('statement');
  });

  it('identifies content by hash, which is what dedupes an upload', () => {
    const reupload = statement().rename('coindcx-statement-copy.pdf');

    expect(reupload.hasSameContentAs(statement())).toBe(true);
  });

  it('treats a different hash as different content', () => {
    const other = Document.create({
      id: 2,
      filename: 'coindcx-march.pdf',
      storedPath: '3e/23/3e23e816.pdf',
      mimeType: 'application/pdf',
      byteSize: 20480,
      sha256: HASH_B,
      docType: 'statement',
      docDate: '2025-03-31',
      extractedText: null,
    });

    expect(other.hasSameContentAs(statement())).toBe(false);
  });

  it('attaches extracted text into a new instance', () => {
    const original = statement();
    const indexed = original.withExtractedText('CoinDCX Statement March 2025');

    expect(indexed.extractedText).toBe('CoinDCX Statement March 2025');
    expect(original.extractedText).toBeNull();
    expect(indexed).not.toBe(original);
  });

  it('keeps the hash and path across a rename and a re-index', () => {
    const changed = statement()
      .rename('march.pdf')
      .withExtractedText('anything');

    expect(changed.sha256).toBe(HASH_A);
    expect(changed.storedPath).toBe('9f/86/9f86d081.pdf');
  });

  it('does not expose a setter for the hash', () => {
    const document = statement();

    expect(() => {
      (document as unknown as { sha256: string }).sha256 = HASH_B;
    }).toThrow();
  });
});
