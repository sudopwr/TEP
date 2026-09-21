import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { DocumentNotFoundError } from '../domain/errors';

import { AttachDocument } from './attach-document';
import { DetachDocument } from './detach-document';
import { LinkDocument } from './link-document';
import { ListDocumentsFor } from './list-documents-for';

const STATEMENT = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);

/**
 * The three halves of a link: make one, break one, and read what is attached.
 *
 * All three exist for the same case — the CoinDCX statement that covers four
 * sales. It is uploaded against the first of them and then *chosen* for the
 * other three, filed against the wrong leg once, and taken off again without
 * anybody deleting the evidence.
 */
const setup = async () => {
  const world = TestWorld.withReferencePayout();
  const attach = new AttachDocument({
    documents: world.documents,
    store: world.store,
  });

  const { document } = await attach.execute({
    bytes: STATEMENT,
    filename: 'coindcx-march.pdf',
    target: { kind: 'transaction', id: 3 },
    mimeType: 'application/pdf',
  });

  return {
    world,
    document,
    link: new LinkDocument({ documents: world.documents }),
    detach: new DetachDocument({ documents: world.documents }),
    list: new ListDocumentsFor({ documents: world.documents }),
  };
};

describe('LinkDocument', () => {
  it('attaches a document already on file to another leg', async () => {
    const { document, link, list } = await setup();

    await link.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 5 },
    });

    await expect(
      list.execute({ target: { kind: 'transaction', id: 5 } }),
    ).resolves.toEqual([document]);
  });

  it('attaches one to the payout as a whole', async () => {
    // The document the trail has nowhere to hang: a contract, or the
    // platform's own statement for the award.
    const { document, link, list } = await setup();

    await link.execute({
      documentId: document.id,
      target: { kind: 'payout', id: 1 },
      role: 'statement',
    });

    await expect(
      list.execute({ target: { kind: 'payout', id: 1 } }),
    ).resolves.toEqual([document]);
  });

  it('is idempotent: the same link twice is one link', async () => {
    const { world, document, link } = await setup();

    await link.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 5 },
    });
    await link.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 5 },
    });

    await expect(world.documents.countLinks(document.id)).resolves.toBe(2);
  });

  it('adds no bytes: the file is already stored', async () => {
    const { world, document, link } = await setup();

    await link.execute({
      documentId: document.id,
      target: { kind: 'payout', id: 1 },
    });

    expect(world.store.size()).toBe(1);
  });

  it('refuses a document that is not on file', async () => {
    const { link } = await setup();

    await expect(
      link.execute({ documentId: 4242, target: { kind: 'payout', id: 1 } }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

describe('DetachDocument', () => {
  it('takes the document off one thing and leaves it on file', async () => {
    const { world, document, detach, list } = await setup();

    await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });

    await expect(
      list.execute({ target: { kind: 'transaction', id: 3 } }),
    ).resolves.toEqual([]);
    await expect(world.documents.findById(document.id)).resolves.not.toBeNull();
    await expect(world.store.exists(document.storedPath)).resolves.toBe(true);
  });

  it('leaves the other attachments alone, and says how many remain', async () => {
    const { document, link, detach, list } = await setup();
    await link.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 5 },
    });

    const detached = await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });

    expect(detached.remainingLinks).toBe(1);
    await expect(
      list.execute({ target: { kind: 'transaction', id: 5 } }),
    ).resolves.toEqual([document]);
  });

  it('reports zero when the last thing lets go', async () => {
    // Not a deleted document: a file on record that nothing points at, which
    // the Documents screen can still find, re-attach or delete outright.
    const { document, detach } = await setup();

    const detached = await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });

    expect(detached.remainingLinks).toBe(0);
  });

  it('is idempotent: detaching what is not attached is not an error', async () => {
    const { document, detach } = await setup();

    await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 5 },
    });

    const stillThere = await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });
    expect(stillThere.remainingLinks).toBe(0);
  });

  it('can be undone by linking it again, which is the point', async () => {
    const { document, detach, link, list } = await setup();

    await detach.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });
    await link.execute({
      documentId: document.id,
      target: { kind: 'transaction', id: 3 },
    });

    await expect(
      list.execute({ target: { kind: 'transaction', id: 3 } }),
    ).resolves.toEqual([document]);
  });

  it('refuses a document that is not on file', async () => {
    const { detach } = await setup();

    await expect(
      detach.execute({ documentId: 4242, target: { kind: 'payout', id: 1 } }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

describe('ListDocumentsFor', () => {
  it('answers with nothing for a target that has none', async () => {
    const { list } = await setup();

    await expect(
      list.execute({ target: { kind: 'payout', id: 1 } }),
    ).resolves.toEqual([]);
  });

  it('answers with what is attached to the payout as a whole', async () => {
    const { document, link, list } = await setup();
    await link.execute({
      documentId: document.id,
      target: { kind: 'payout', id: 1 },
    });

    const attached = await list.execute({
      target: { kind: 'payout', id: 1 },
    });

    expect(attached.map((one) => one.filename)).toEqual(['coindcx-march.pdf']);
  });
});
