import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { DocumentNotFoundError } from '../domain/errors';

import { AttachDocument } from './attach-document';
import { DeleteDocument } from './delete-document';

const STATEMENT = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);

const setup = async () => {
  const world = TestWorld.withReferencePayout();
  const attach = new AttachDocument({
    documents: world.documents,
    store: world.store,
  });
  const useCase = new DeleteDocument({
    documents: world.documents,
    store: world.store,
  });

  // The same statement as evidence for the payout and for the sale that
  // settled it — F6's whole point, and the case this use case turns on.
  const { document } = await attach.execute({
    bytes: STATEMENT,
    filename: 'coindcx-march.pdf',
    target: { kind: 'payout', id: 1 },
    mimeType: 'application/pdf',
  });
  await attach.execute({
    bytes: STATEMENT,
    filename: 'coindcx-march.pdf',
    target: { kind: 'transaction', id: 3 },
  });

  return { world, useCase, document };
};

describe('DeleteDocument', () => {
  it('removes the document', async () => {
    const { world, useCase, document } = await setup();

    await useCase.execute({ documentId: document.id });

    await expect(world.documents.findById(document.id)).resolves.toBeNull();
  });

  it('takes every attachment with it, and says how many', async () => {
    // A document is a thing, not a relationship: deleting one cannot leave
    // the sale still claiming it as evidence.
    const { world, useCase, document } = await setup();

    const deleted = await useCase.execute({ documentId: document.id });

    expect(deleted.linksRemoved).toBe(2);
    await expect(
      world.documents.listForTarget({ kind: 'payout', id: 1 }),
    ).resolves.toEqual([]);
    await expect(
      world.documents.listForTarget({ kind: 'transaction', id: 3 }),
    ).resolves.toEqual([]);
  });

  it('removes the file as well as the row', async () => {
    const { world, useCase, document } = await setup();

    await useCase.execute({ documentId: document.id });

    await expect(world.store.exists(document.storedPath)).resolves.toBe(false);
    expect(world.store.size()).toBe(0);
  });

  it('hands back the row as it was, so the caller can name it', async () => {
    const { useCase, document } = await setup();

    const deleted = await useCase.execute({ documentId: document.id });

    expect(deleted.document.filename).toBe('coindcx-march.pdf');
    expect(deleted.document.sha256).toBe(document.sha256);
  });

  it('deletes a document nothing is attached to', async () => {
    const { world, useCase, document } = await setup();
    await world.documents.unlink(document.id, { kind: 'payout', id: 1 });
    await world.documents.unlink(document.id, { kind: 'transaction', id: 3 });

    const deleted = await useCase.execute({ documentId: document.id });

    expect(deleted.linksRemoved).toBe(0);
    await expect(world.documents.findById(document.id)).resolves.toBeNull();
  });

  it('deletes a row whose bytes have already gone', async () => {
    // The row somebody most wants rid of: refusing would strand it, and
    // `DocumentStore.remove` is forgiving about a file that is not there.
    const { world, useCase, document } = await setup();
    await world.store.remove(document.storedPath);

    await useCase.execute({ documentId: document.id });

    await expect(world.documents.findById(document.id)).resolves.toBeNull();
  });

  it('refuses a document that is not there', async () => {
    const { useCase } = await setup();

    await expect(useCase.execute({ documentId: 4242 })).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });

  it('leaves the payout and the leg it was attached to standing', async () => {
    // The evidence goes; what it was evidence for does not.
    const { world, useCase, document } = await setup();

    await useCase.execute({ documentId: document.id });

    await expect(world.payouts.findById(1)).resolves.not.toBeNull();
    await expect(world.transactions.findById(3)).resolves.not.toBeNull();
  });
});
