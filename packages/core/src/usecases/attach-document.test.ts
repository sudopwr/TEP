import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';

import { AttachDocument, type AttachDocumentCommand } from './attach-document';

const STATEMENT = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
const DIFFERENT = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32, 0x2e]);

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new AttachDocument({
    documents: world.documents,
    store: world.store,
  });
  return { world, useCase };
};

const command = (
  overrides: Partial<AttachDocumentCommand> = {},
): AttachDocumentCommand => ({
  bytes: STATEMENT,
  filename: 'coindcx-march.pdf',
  target: { kind: 'payout', id: 1 },
  mimeType: 'application/pdf',
  docType: 'statement',
  ...overrides,
});

describe('AttachDocument (UC4)', () => {
  it('stores the bytes and records the document', async () => {
    const { world, useCase } = setup();

    const { document, created } = await useCase.execute(command());

    expect(created).toBe(true);
    expect(document.filename).toBe('coindcx-march.pdf');
    expect(document.byteSize).toBe(STATEMENT.byteLength);
    expect(document.sha256).toHaveLength(64);
    expect(world.store.size()).toBe(1);
  });

  it('links the document to its target', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command({ role: 'statement' }));
    const linked = await world.documents.listForTarget({
      kind: 'payout',
      id: 1,
    });

    expect(linked).toHaveLength(1);
    expect(linked[0]?.filename).toBe('coindcx-march.pdf');
  });

  it('creates ONE document and TWO links for identical bytes', async () => {
    const { world, useCase } = setup();

    const first = await useCase.execute(
      command({ target: { kind: 'payout', id: 1 } }),
    );
    const second = await useCase.execute(
      command({ target: { kind: 'transaction', id: 3 } }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.document.id).toBe(first.document.id);

    expect(world.documents.documentCount()).toBe(1);
    expect(world.documents.linkCount()).toBe(2);
  });

  it('keeps one stored file for identical bytes', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command({ target: { kind: 'payout', id: 1 } }));
    await useCase.execute(command({ target: { kind: 'transaction', id: 3 } }));

    expect(world.store.size()).toBe(1);
  });

  it('dedupes on content, not on filename', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command());
    const second = await useCase.execute(
      command({
        filename: 'a-completely-different-name.pdf',
        target: { kind: 'company', id: 1 },
      }),
    );

    expect(second.created).toBe(false);
    expect(world.documents.documentCount()).toBe(1);
    // The first upload's name is the one that stuck.
    expect(second.document.filename).toBe('coindcx-march.pdf');
  });

  it('makes a second document for different bytes', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command());
    const second = await useCase.execute(command({ bytes: DIFFERENT }));

    expect(second.created).toBe(true);
    expect(world.documents.documentCount()).toBe(2);
    expect(world.store.size()).toBe(2);
  });

  it('re-linking the same document to the same target stays one link', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command());
    await useCase.execute(command());

    expect(world.documents.documentCount()).toBe(1);
    expect(world.documents.linkCount()).toBe(1);
  });

  it('attaches one document to all three kinds of target', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command({ target: { kind: 'company', id: 1 } }));
    await useCase.execute(command({ target: { kind: 'payout', id: 1 } }));
    await useCase.execute(command({ target: { kind: 'transaction', id: 3 } }));

    expect(world.documents.documentCount()).toBe(1);
    expect(world.documents.linkCount()).toBe(3);
  });

  it('carries extracted text through for the search index', async () => {
    const { useCase } = setup();

    const { document } = await useCase.execute(
      command({ extractedText: 'CoinDCX Statement March 2025' }),
    );

    expect(document.extractedText).toBe('CoinDCX Statement March 2025');
  });
});
