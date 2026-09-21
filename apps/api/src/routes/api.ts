import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  DocumentTarget,
  DocumentType,
  PayoutScope,
  RoundingMode,
} from '@payout/core';

import * as out from './serialize';
import {
  attachDocumentFields,
  balancesQuery,
  documentLinkParams,
  createAccountBody,
  createCompanyBody,
  createPayoutBody,
  createTraderBody,
  createTransactionBody,
  dataQualityQuery,
  financialYearQuery,
  idParam,
  listAccountsQuery,
  listPayoutsQuery,
  linkDocumentBody,
  listTransactionsQuery,
  searchDocumentsQuery,
  settlementQuery,
  updateAccountBody,
  updateTransactionBody,
} from './schemas';
import { parseOrThrow } from './validate';

/**
 * The data routes (F1-F13), all under `/api`.
 *
 * Every handler is the same three lines with different nouns: parse the
 * request with a zod schema, call exactly one use case, serialize the result.
 * No handler reaches a repository, constructs a `Money`, or decides anything.
 * If a route here ever needs an `if` about the domain, the `if` belongs in a
 * use case and the route belongs unchanged.
 *
 * Use cases arrive on the instance via `fastify.decorate` (see
 * `container.ts`), so this file imports no adapter and no container — which
 * is also what lets a test swap in a fake by decorating the same name.
 */
/** The shared selection (F24), as the four read routes receive it. */
function scopeOf(query: {
  traderId?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): PayoutScope {
  return {
    ...(query.traderId === undefined ? {} : { traderId: query.traderId }),
    ...(query.from === undefined || query.to === undefined
      ? {}
      : { range: { from: query.from, to: query.to } }),
  };
}

export function registerApiRoutes(app: FastifyInstance): void {
  // ---------- Companies (F1) ----------

  app.get('/api/companies', async () => {
    const companies = await app.useCases.listCompanies.execute();
    return { companies: companies.map(out.company) };
  });

  app.post('/api/companies', async (request, reply) => {
    const body = parseOrThrow(createCompanyBody, request.body, 'body');

    const company = await app.useCases.recordCompany.execute({
      code: body.code,
      name: body.name,
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    return reply.status(201).send({ company: out.company(company) });
  });

  // ---------- Traders (F24) ----------

  /*
    Who the ledger keeps payouts for.

    Not `/api/users`, and the distinction is the feature: §5a's user is the
    one sign-in account, and a trader is a person the money belongs to. One
    admin manages several, none of them can sign in, and a name typed into a
    dropdown never becomes a credential.
  */
  app.get('/api/traders', async () => {
    const traders = await app.useCases.listTraders.execute();
    return { traders: traders.map(out.trader) };
  });

  app.post('/api/traders', async (request, reply) => {
    const body = parseOrThrow(createTraderBody, request.body, 'body');

    const trader = await app.useCases.recordTrader.execute({
      code: body.code,
      name: body.name,
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    return reply.status(201).send({ trader: out.trader(trader) });
  });

  // ---------- Accounts (F1) ----------

  /*
    Every account, not only the ones money has moved through.

    `/api/accounts/balances` is the other account endpoint and answers a
    different question: it is derived from movements (UC7), so an account
    that has never taken part in one is absent from it. That is right for a
    balance sheet and wrong for a form asking where money went — which is why
    both exist, and why this one is not a filter over that one.
  */
  app.get('/api/accounts', async (request) => {
    const query = parseOrThrow(listAccountsQuery, request.query, 'query');

    const accounts = await app.useCases.listAccounts.execute(
      query.type === undefined ? {} : { type: query.type },
    );

    return { accounts: accounts.map(out.account) };
  });

  app.post('/api/accounts', async (request, reply) => {
    const body = parseOrThrow(createAccountBody, request.body, 'body');

    const account = await app.useCases.recordAccount.execute({
      code: body.code,
      name: body.name,
      type: body.type,
      ...(body.companyId === undefined ? {} : { companyId: body.companyId }),
      ...(body.allowedCurrencies === undefined
        ? {}
        : { allowedCurrencies: body.allowedCurrencies }),
    });

    return reply.status(201).send({ account: out.account(account) });
  });

  /*
    F1 — correct an account. A replacement, not a patch: see
    `updateAccountBody` for why the allow-list makes that the only honest
    reading.
  */
  app.put('/api/accounts/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');
    const body = parseOrThrow(updateAccountBody, request.body, 'body');

    const account = await app.useCases.editAccount.execute({
      accountId: id,
      code: body.code,
      name: body.name,
      type: body.type,
      ...(body.companyId === undefined ? {} : { companyId: body.companyId }),
      ...(body.allowedCurrencies === undefined
        ? {}
        : { allowedCurrencies: body.allowedCurrencies }),
    });

    return { account: out.account(account) };
  });

  /*
    F1 — remove an account nothing has moved through.

    409 when something has, carrying the count: the account is a party to
    those legs, and deleting it would leave them pointing at nothing. The
    body names what went so the reader sees which account, since the id in
    the URL is not what they called it.
  */
  app.delete('/api/accounts/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const account = await app.useCases.deleteAccount.execute({
      accountId: id,
    });

    return { account: out.account(account) };
  });

  // ---------- Payouts (F2, F8, F9) ----------

  app.get('/api/payouts', async (request) => {
    const query = parseOrThrow(listPayoutsQuery, request.query, 'query');

    const payouts = await app.useCases.listPayouts.execute({
      ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
      ...(query.traderId === undefined ? {} : { traderId: query.traderId }),
      ...(query.from === undefined || query.to === undefined
        ? {}
        : { range: { from: query.from, to: query.to } }),
    });

    return { payouts: payouts.map(out.payout) };
  });

  app.post('/api/payouts', async (request, reply) => {
    const body = parseOrThrow(createPayoutBody, request.body, 'body');

    const payout = await app.useCases.recordPayout.execute({
      code: body.code,
      companyId: body.companyId,
      traderId: body.traderId,
      grossAmount: body.grossAmount,
      currencyCode: body.currencyCode,
      ...(body.payoutDate === undefined ? {} : { payoutDate: body.payoutDate }),
      ...(body.charges === undefined ? {} : { charges: body.charges }),
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    return reply.status(201).send({ payout: out.payout(payout) });
  });

  /*
    F2 — remove a payout that should not have been recorded.

    A DELETE that answers with a body rather than 204: the reader is about to
    be told what happened, and "Payout deleted" is a worse sentence than
    naming the code and the thirteen legs that went with it. The counts come
    from the use case, which took them while there was still something to
    count.
  */
  app.delete('/api/payouts/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const deleted = await app.useCases.deletePayout.execute({ payoutId: id });

    return {
      payout: out.payout(deleted.payout),
      transactionsDeleted: deleted.transactionsDeleted,
      feesDeleted: deleted.feesDeleted,
    };
  });

  app.get('/api/payouts/:id/trail', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const trail = await app.useCases.getPayoutTrail.execute({ payoutId: id });

    return out.payoutTrail(trail);
  });

  app.get('/api/payouts/:id/settlement', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');
    const query = parseOrThrow(settlementQuery, request.query, 'query');

    const settlement = await app.useCases.getSettlement.execute({
      payoutId: id,
      ...(query.currencyCode === undefined
        ? {}
        : { settlementCurrencyCode: query.currencyCode }),
    });

    return out.settlement(settlement);
  });

  // ---------- Transactions (F3, F4, F5) ----------

  app.get('/api/transactions', async (request) => {
    const query = parseOrThrow(listTransactionsQuery, request.query, 'query');

    const transactions = await app.useCases.listTransactions.execute({
      ...(query.payoutId === undefined ? {} : { payoutId: query.payoutId }),
    });

    return { transactions: transactions.map(out.transaction) };
  });

  /**
   * One endpoint, two use cases, chosen by the body's own discriminator.
   *
   * The schema is a discriminated union on `kind`, so by the time the handler
   * runs the decision has already been made by the parser — the branch below
   * reads a tag, it does not weigh anything. A sale genuinely is a different
   * command: gross proceeds come from the rate rather than the request (§13),
   * the fee schedule applies, and TDS is accepted from the statement.
   */
  app.post('/api/transactions', async (request, reply) => {
    const body = parseOrThrow(createTransactionBody, request.body, 'body');

    if (body.kind === 'sale') {
      const recorded = await app.useCases.recordSale.execute({
        code: body.code,
        payoutId: body.payoutId,
        parentId: body.parentId ?? null,
        txnDate: body.txnDate,
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        fromAmount: body.fromAmount,
        fromCurrencyCode: body.fromCurrencyCode,
        rate: body.rate,
        settlementCurrencyCode: body.settlementCurrencyCode,
        ...(body.tds === undefined ? {} : { tds: body.tds }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        rounding: 'half-up' satisfies RoundingMode,
      });

      return reply.status(201).send({
        transaction: out.transaction(recorded.transaction),
        grossProceeds: out.money(recorded.grossProceeds),
        fees: recorded.fees.map(out.transactionFee),
        totalFees: out.money(recorded.totalFees),
        netCredited: out.money(recorded.netCredited),
      });
    }

    const transaction = await app.useCases.recordTransaction.execute({
      code: body.code,
      payoutId: body.payoutId,
      parentId: body.parentId ?? null,
      txnDate: body.txnDate,
      kind: body.kind,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      fromAmount: body.fromAmount,
      fromCurrencyCode: body.fromCurrencyCode,
      toAmount: body.toAmount,
      toCurrencyCode: body.toCurrencyCode,
      rate: body.rate ?? null,
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    return reply
      .status(201)
      .send({ transaction: out.transaction(transaction) });
  });

  /*
    F21 — correct a leg.

    A replacement of the row, and only of the row: the payout, the parent, the
    kind and the fees are carried forward by the use case, which says why for
    each. Editing a sale's amounts can leave its fees off §8's schedule — §7
    puts that in `v_data_quality` rather than in a constraint, so the checks
    report it and the reader decides.
  */
  app.put('/api/transactions/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');
    const body = parseOrThrow(updateTransactionBody, request.body, 'body');

    const transaction = await app.useCases.editTransaction.execute({
      transactionId: id,
      code: body.code,
      txnDate: body.txnDate,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      fromAmount: body.fromAmount,
      fromCurrencyCode: body.fromCurrencyCode,
      toAmount: body.toAmount,
      toCurrencyCode: body.toCurrencyCode,
      rate: body.rate ?? null,
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    return { transaction: out.transaction(transaction) };
  });

  /*
    F20 — remove a leg, and the legs below it.

    The subtree, not the row: a child is money that arrived from this leg, and
    orphaning it would manufacture the broken link §7 leaves to the trail to
    display. The counts come back so the browser can name what went, and
    `payoutId` so it knows which trail, settlement and checks to re-read.
  */
  app.delete('/api/transactions/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const deleted = await app.useCases.deleteTransaction.execute({
      transactionId: id,
    });

    return {
      transaction: out.transaction(deleted.transaction),
      payoutId: deleted.payoutId,
      transactionsDeleted: deleted.transactionsDeleted,
      feesDeleted: deleted.feesDeleted,
    };
  });

  // ---------- Documents (F6, F7) ----------

  /**
   * Multipart upload, attached to a transaction (UC4).
   *
   * The file is buffered here rather than streamed, and that is not an
   * oversight: UC4 dedupes on the SHA-256 of the whole file, so the whole file
   * has to exist before anything can be decided about it. `@fastify/multipart`
   * caps the size, so "buffer it" has a ceiling rather than being an invitation.
   */
  /*
    The body of both upload routes — a leg's and a payout's.

    Written once because it is the same act: F6 attaches a file to a company,
    a payout *or* a transaction, and only the target differs. Two copies of
    the 415, the field parsing and the dedupe report would drift the first
    time one of them was corrected.
  */
  const uploadTo = async (
    target: DocumentTarget,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const file = await readUploadedFile(request);

    if (file === null) {
      // 415 rather than 400: the body may be perfectly well-formed JSON, it
      // is the media type this route cannot take. @fastify/multipart's own
      // answer is 406, which says the *client* would not accept our reply —
      // the opposite of what happened.
      return reply.status(415).send({
        code: 'unsupported_media_type',
        message:
          'Expected multipart/form-data with exactly one file field named "file".',
      });
    }

    const bytes = await file.toBuffer();

    // Multipart fields arrive as parts, not as a body object.
    const fields = parseOrThrow(
      attachDocumentFields,
      textFieldsOf(file.fields),
      'body',
    );

    const attached = await app.useCases.attachDocument.execute({
      bytes: new Uint8Array(bytes),
      filename: file.filename,
      target,
      mimeType: file.mimetype,
      ...(fields.role === undefined ? {} : { role: fields.role }),
      ...(fields.docType === undefined
        ? {}
        : { docType: fields.docType satisfies DocumentType | null }),
      ...(fields.docDate === undefined ? {} : { docDate: fields.docDate }),
    });

    return reply.status(attached.created ? 201 : 200).send({
      document: out.document(attached.document),
      // False when the bytes were already on file and only a link was added.
      created: attached.created,
    });
  };

  app.post('/api/transactions/:id/documents', async (request, reply) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    return uploadTo({ kind: 'transaction', id }, request, reply);
  });

  /*
    F6's other target: the payout as a whole.

    A leg's documents arrive with the trail (UC5 hangs them on their node),
    but a document covering the whole award — the contract, the platform's own
    statement — belongs to none of the legs, and until this there was nowhere
    to put it and nowhere to see it.
  */
  app.post('/api/payouts/:id/documents', async (request, reply) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    return uploadTo({ kind: 'payout', id }, request, reply);
  });

  app.get('/api/payouts/:id/documents', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const documents = await app.useCases.listDocumentsFor.execute({
      target: { kind: 'payout', id },
    });

    return { documents: documents.map(out.document) };
  });

  /*
    F23 — attach a file that is already on file, and take one off again.

    Four routes because there are two targets and two directions, and one
    sentence covers all four: a link is a relationship, and these make and
    break it without touching the document. The statement covering four sales
    is uploaded once against the first and *chosen* for the other three;
    filing one against the wrong leg is undone by taking it off, not by
    deleting the evidence (F22 is the other verb, and means the file itself).

    Both are idempotent, which is what a PUT-shaped link and a DELETE should
    be: `document_links` has a partial unique index per target, so linking
    twice is one link, and detaching what is not attached is the state the
    caller asked for.
  */
  const linkRoutes = [
    { path: '/api/payouts/:id/documents/:documentId', kind: 'payout' },
    {
      path: '/api/transactions/:id/documents/:documentId',
      kind: 'transaction',
    },
  ] as const;

  for (const { path, kind } of linkRoutes) {
    app.post(path, async (request) => {
      const { id, documentId } = parseOrThrow(
        documentLinkParams,
        request.params,
        'params',
      );
      const body = parseOrThrow(linkDocumentBody, request.body ?? {}, 'body');

      const document = await app.useCases.linkDocument.execute({
        documentId,
        target: { kind, id },
        ...(body.role === undefined ? {} : { role: body.role }),
      });

      return { document: out.document(document) };
    });

    app.delete(path, async (request) => {
      const { id, documentId } = parseOrThrow(
        documentLinkParams,
        request.params,
        'params',
      );

      const detached = await app.useCases.detachDocument.execute({
        documentId,
        target: { kind, id },
      });

      return {
        document: out.document(detached.document),
        // Zero is a file nothing points at, not a deleted one (F22).
        remainingLinks: detached.remainingLinks,
      };
    });
  }

  /**
   * Stream one document by id (F6).
   *
   * Served through a handler, never a static mount. A static mount on
   * `data/files` would publish every file to anyone who can guess a
   * content-addressed path, with no session check and no way to add one —
   * and the paths are derivable from a hash that the search endpoint returns.
   * Here, the guards have already run before this line.
   *
   * `Content-Disposition` is `inline` with the original filename, so a PDF
   * opens in the browser and a download still gets the right name. The
   * filename is quoted and stripped of quotes and control characters, because
   * it came from an upload.
   */
  app.get('/api/documents/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const document = await app.useCases.getDocument.execute({ documentId: id });

    return reply
      .header('content-type', document.mimeType ?? 'application/octet-stream')
      .header(
        'content-disposition',
        `inline; filename="${safeFilename(document.filename)}"`,
      )
      .header('x-content-type-options', 'nosniff')
      .send(app.documentFiles.openReadStream(document.storedPath));
  });

  /*
    F22 — delete a document: the row, every link to it, and the file.

    Everywhere rather than from one place: F6 makes one file evidence for
    several things, and a document is a thing rather than a relationship. The
    count of what lost it comes back so the browser can say so — the reader
    saw one attachment and may be removing three.
  */
  app.delete('/api/documents/:id', async (request) => {
    const { id } = parseOrThrow(idParam, request.params, 'params');

    const deleted = await app.useCases.deleteDocument.execute({
      documentId: id,
    });

    return {
      document: out.document(deleted.document),
      linksRemoved: deleted.linksRemoved,
    };
  });

  app.get('/api/documents/search', async (request) => {
    const query = parseOrThrow(searchDocumentsQuery, request.query, 'query');

    const documents = await app.useCases.searchDocuments.execute({
      query: query.q,
    });

    return { documents: documents.map(out.document) };
  });

  // ---------- Balances, checks, reports (F10, F11, F13) ----------

  app.get('/api/accounts/balances', async (request) => {
    const query = parseOrThrow(balancesQuery, request.query, 'query');

    const balances = await app.useCases.getAccountBalances.execute({
      ...(query.payoutId === undefined ? {} : { payoutId: query.payoutId }),
      scope: scopeOf(query),
    });

    return { balances: balances.map(out.accountBalance) };
  });

  app.get('/api/data-quality', async (request) => {
    const query = parseOrThrow(dataQualityQuery, request.query, 'query');

    const issues = await app.useCases.runDataQualityChecks.execute({
      ...(query.payoutId === undefined ? {} : { payoutId: query.payoutId }),
      scope: scopeOf(query),
      ...(query.tolerancePct === undefined
        ? {}
        : { feeTolerancePct: query.tolerancePct }),
    });

    return { issues: issues.map(out.dataQualityIssue) };
  });

  app.get('/api/reports/financial-year', async (request) => {
    const query = parseOrThrow(financialYearQuery, request.query, 'query');

    const report = await app.useCases.generateFinancialYearReport.execute({
      range: { from: query.from, to: query.to },
      ...(query.currencyCode === undefined
        ? {}
        : { settlementCurrencyCode: query.currencyCode }),
      // The range is this route's own required argument, so only the trader
      // half of the shared selection (F24) applies here.
      ...(query.traderId === undefined ? {} : { traderId: query.traderId }),
    });

    return out.financialYearReport(report);
  });
}

/**
 * The uploaded file, or null when this was not a multipart request at all.
 *
 * `request.file()` throws rather than returning undefined when the content
 * type is wrong, and that throw carries a 406 which would reach the client
 * unchanged. Converting it here keeps the status honest.
 */
type UploadedFile = NonNullable<Awaited<ReturnType<FastifyRequest['file']>>>;

async function readUploadedFile(
  request: FastifyRequest,
): Promise<UploadedFile | null> {
  if (!request.isMultipart()) {
    return null;
  }

  return (await request.file()) ?? null;
}

/** The text parts of a multipart body, as a plain object zod can parse. */
function textFieldsOf(fields: unknown): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof fields !== 'object' || fields === null) {
    return result;
  }

  for (const [name, part] of Object.entries(fields)) {
    if (
      typeof part === 'object' &&
      part !== null &&
      'value' in part &&
      typeof (part as { value: unknown }).value === 'string'
    ) {
      result[name] = (part as { value: string }).value;
    }
  }

  return result;
}

/**
 * A filename safe to put inside a quoted header value.
 *
 * A quote would end the field early and a newline would end the header —
 * both are header injection, and the name came from whoever uploaded the
 * file. Filtered by code point rather than by regex so the control
 * characters being removed do not have to appear in the source to remove
 * them.
 */
export function safeFilename(filename: string): string {
  let safe = '';

  for (const character of filename) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f;

    if (
      isControl ||
      character === '"' ||
      character === String.fromCharCode(92)
    ) {
      continue;
    }

    safe += character;
  }

  // A name made entirely of stripped characters would produce `filename=""`.
  return safe.length > 0 ? safe : 'document';
}
