import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { rejection } from '../../test/rejection';
import {
  CompanyCodeTakenError,
  DocumentFileMissingError,
  DocumentNotFoundError,
} from '../domain/errors';

import { GetDocument } from './get-document';
import { ListCompanies } from './list-companies';
import { ListPayouts } from './list-payouts';
import { ListTransactions } from './list-transactions';
import { RecordCompany } from './record-company';

/**
 * The five reads and writes §3 does not number.
 *
 * UC1-UC14 start at recording a payout and assume a company already exists,
 * and they offer no way to list anything. The routes need both. These are
 * use cases rather than repository calls from a route so that "no business
 * logic in routes" stays a checkable rule instead of a hope.
 */

describe('RecordCompany (F1)', () => {
  const setup = () => {
    const world = new TestWorld();
    return {
      world,
      useCase: new RecordCompany({ companies: world.companies }),
    };
  };

  it('records a company and allocates an id', async () => {
    const { useCase } = setup();

    const company = await useCase.execute({
      code: 'Tradeify',
      name: 'Tradeify LLC',
    });

    expect(company.id).toBeGreaterThan(0);
    expect(company.code).toBe('Tradeify');
    expect(company.name).toBe('Tradeify LLC');
  });

  it('defaults notes to null rather than undefined', async () => {
    const { useCase } = setup();

    const company = await useCase.execute({ code: 'Rise', name: 'Rise Works' });

    expect(company.notes).toBeNull();
  });

  it('keeps notes when given', async () => {
    const { useCase } = setup();

    const company = await useCase.execute({
      code: 'Rise',
      name: 'Rise Works',
      notes: 'processor',
    });

    expect(company.notes).toBe('processor');
  });

  it('persists, rather than only returning', async () => {
    const { world, useCase } = setup();

    const company = await useCase.execute({ code: 'Rise', name: 'Rise Works' });

    await expect(world.companies.findById(company.id)).resolves.toMatchObject({
      code: 'Rise',
    });
  });

  it('refuses a code that is already taken', async () => {
    const { useCase } = setup();
    await useCase.execute({ code: 'Rise', name: 'Rise Works' });

    const error = await rejection<CompanyCodeTakenError>(
      useCase.execute({ code: 'Rise', name: 'Someone Else' }),
    );

    expect(error).toBeInstanceOf(CompanyCodeTakenError);
    expect(error.code).toBe('Rise');
  });

  it('says which code clashed, because the constraint would not', async () => {
    const { useCase } = setup();
    await useCase.execute({ code: 'Rise', name: 'Rise Works' });

    const error = await rejection(
      useCase.execute({ code: 'Rise', name: 'Someone Else' }),
    );

    expect(error.message).toContain('Rise');
  });
});

describe('ListCompanies', () => {
  it('returns nothing on an empty ledger', async () => {
    const world = new TestWorld();

    await expect(
      new ListCompanies({ companies: world.companies }).execute(),
    ).resolves.toEqual([]);
  });

  it('returns the companies that have been recorded', async () => {
    const world = TestWorld.withCounterparties();

    const listed = await new ListCompanies({
      companies: world.companies,
    }).execute();

    expect(listed.map((one) => one.code).sort()).toEqual([
      'Rise001',
      'Tradeify001',
    ]);
  });
});

describe('ListPayouts (F2)', () => {
  const setup = () => {
    const world = TestWorld.withReferencePayout();
    return { world, useCase: new ListPayouts({ payouts: world.payouts }) };
  };

  it('returns every payout when nothing is asked for', async () => {
    const { useCase } = setup();

    const listed = await useCase.execute();

    expect(listed.map((one) => one.code)).toEqual(['TradeifyPayout001']);
  });

  it('narrows by company', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ companyId: 1 })).resolves.toHaveLength(1);
    await expect(useCase.execute({ companyId: 99 })).resolves.toEqual([]);
  });

  it('narrows by date range', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ range: { from: '2025-01-01', to: '2025-12-31' } }),
    ).resolves.toHaveLength(1);
    await expect(
      useCase.execute({ range: { from: '2024-01-01', to: '2024-12-31' } }),
    ).resolves.toEqual([]);
  });

  it('applies both filters together', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({
        companyId: 1,
        range: { from: '2025-01-01', to: '2025-12-31' },
      }),
    ).resolves.toHaveLength(1);
    await expect(
      useCase.execute({
        companyId: 99,
        range: { from: '2025-01-01', to: '2025-12-31' },
      }),
    ).resolves.toEqual([]);
  });
});

describe('ListTransactions (F3)', () => {
  const setup = () => {
    const world = TestWorld.withReferencePayout();
    return {
      world,
      useCase: new ListTransactions({ transactions: world.transactions }),
    };
  };

  it('returns the whole ledger when nothing is asked for', async () => {
    const { useCase } = setup();

    await expect(useCase.execute()).resolves.toHaveLength(13);
  });

  it('narrows to one payout', async () => {
    const { useCase } = setup();

    const listed = await useCase.execute({ payoutId: 1 });

    expect(listed).toHaveLength(13);
    expect(listed.every((one) => one.payoutId === 1)).toBe(true);
  });

  it('returns nothing for a payout with no legs', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ payoutId: 99 })).resolves.toEqual([]);
  });

  it('is flat, not a tree — a child appears at the top level', async () => {
    const { useCase } = setup();

    const listed = await useCase.execute();

    expect(listed.some((one) => one.parentId !== null)).toBe(true);
  });
});

describe('GetDocument (F6)', () => {
  const setup = async () => {
    const world = TestWorld.withReferencePayout();
    const stored = await world.store.put(
      new TextEncoder().encode('a statement'),
      'coindcx-march.pdf',
    );
    const document = await world.documents.insert({
      filename: 'coindcx-march.pdf',
      storedPath: stored.storedPath,
      mimeType: 'application/pdf',
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      docType: 'statement',
      docDate: '2025-03-31',
      extractedText: null,
    });

    return {
      world,
      document,
      useCase: new GetDocument({
        documents: world.documents,
        store: world.store,
      }),
    };
  };

  it('returns the metadata a route needs to serve the file', async () => {
    const { document, useCase } = await setup();

    const found = await useCase.execute({ documentId: document.id });

    expect(found.filename).toBe('coindcx-march.pdf');
    expect(found.mimeType).toBe('application/pdf');
    expect(found.storedPath).toBe(document.storedPath);
  });

  it('does not return the bytes', async () => {
    // A 40MB statement should not pass through memory twice on its way out.
    const { document, useCase } = await setup();

    const found = await useCase.execute({ documentId: document.id });

    expect(found).not.toHaveProperty('bytes');
    expect(found).not.toHaveProperty('content');
  });

  it('rejects an id that does not exist', async () => {
    const { useCase } = await setup();

    await expect(useCase.execute({ documentId: 999 })).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });

  it('rejects a row whose file is missing from the store', async () => {
    // Better a 404 with a sentence than a stream that dies half way through
    // with the status line already sent.
    const { world, useCase } = await setup();
    const orphan = await world.documents.insert({
      filename: 'gone.pdf',
      storedPath: 'ab/cd/abcdef.pdf',
      mimeType: 'application/pdf',
      byteSize: 10,
      sha256: 'f'.repeat(64),
      docType: null,
      docDate: null,
      extractedText: null,
    });

    const error = await rejection<DocumentFileMissingError>(
      useCase.execute({ documentId: orphan.id }),
    );

    expect(error).toBeInstanceOf(DocumentFileMissingError);
    expect(error.storedPath).toBe('ab/cd/abcdef.pdf');
  });
});
