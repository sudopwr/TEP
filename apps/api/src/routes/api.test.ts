import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteDocumentRepository } from '../adapters/sqlite-document-repository';

import {
  asUser,
  authenticate,
  buildTestServer,
  seedCounterparties,
  seedReferencePayout,
  type TestServer,
} from '../../test/build-test-server';

/**
 * Every `/api` route, against a real in-memory database.
 *
 * No mocks and no shortcut past the guards: `authenticate` signs in as the
 * shipped admin and clears the must-change flag through the real endpoint,
 * so each of these requests has been through cookie signing, the session
 * guard and the password guard before the handler ran.
 *
 * The numbers are §10's. The seeded tree is the same TradeifyPayout001
 * fixture the domain tests assert ₹84,642.93 against, so a route returning a
 * wrong figure fails here rather than looking plausible.
 */
describe('/api routes', () => {
  let server: TestServer;
  let cookie: string;

  const withSeed = async (seed?: (database: never) => void) => {
    server = await buildTestServer(
      seed === undefined ? {} : { seed: seed as () => void },
    );
    cookie = await authenticate(server);
  };

  afterEach(async () => {
    await server.close();
  });

  const get = (url: string) => asUser(server, cookie, { url });
  const post = (url: string, payload: Record<string, unknown>) =>
    asUser(server, cookie, { method: 'POST', url, payload });
  const del = (url: string) =>
    asUser(server, cookie, { method: 'DELETE', url });

  describe('GET /health', () => {
    beforeEach(async () => {
      await withSeed();
    });

    it('answers without a session, because a liveness check must', async () => {
      const response = await server.app.inject({ url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('the guards apply to every /api route', () => {
    beforeEach(async () => {
      await withSeed();
    });

    const EVERY_ROUTE = [
      '/api/companies',
      '/api/accounts',
      '/api/payouts',
      '/api/payouts/1/trail',
      '/api/payouts/1/settlement',
      '/api/transactions',
      '/api/documents/1',
      '/api/documents/search?q=x',
      '/api/accounts/balances',
      '/api/data-quality',
      '/api/reports/financial-year?from=2025-04-01&to=2026-03-31',
    ];

    it.each(EVERY_ROUTE)('401s %s with no session', async (url) => {
      const response = await server.app.inject({ url });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        code: 'authentication_required',
      });
    });

    it.each(EVERY_ROUTE)('403s %s while the flag is set', async (url) => {
      // A fresh server, signed in but with the password still `admin`.
      const fresh = await buildTestServer();
      try {
        const login = await fresh.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { username: 'admin', password: 'admin' },
        });
        const raw = login.cookies.find((one) => one.name === 'payout_session');

        const response = await fresh.app.inject({
          url,
          headers: { cookie: `payout_session=${String(raw?.value)}` },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          code: 'password_change_required',
        });
      } finally {
        await fresh.close();
      }
    });

    it('401s a POST too, not only the reads', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/companies',
        payload: { code: 'x', name: 'x' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('companies (F1)', () => {
    beforeEach(async () => {
      await withSeed();
    });

    it('starts empty', async () => {
      const response = await get('/api/companies');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ companies: [] });
    });

    it('records one and returns 201 with the allocated id', async () => {
      const response = await post('/api/companies', {
        code: 'Tradeify001',
        name: 'Tradeify LLC',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().company).toMatchObject({
        id: 1,
        code: 'Tradeify001',
        name: 'Tradeify LLC',
        notes: null,
      });
    });

    it('lists what was recorded', async () => {
      await post('/api/companies', { code: 'A', name: 'Alpha' });
      await post('/api/companies', { code: 'B', name: 'Beta' });

      const response = await get('/api/companies');

      expect(response.json().companies).toHaveLength(2);
    });

    it('409s a duplicate code, with the code in the detail', async () => {
      await post('/api/companies', { code: 'A', name: 'Alpha' });

      const response = await post('/api/companies', {
        code: 'A',
        name: 'Again',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'company_code_taken',
        details: { code: 'A' },
      });
    });

    it('400s a missing field with the field named', async () => {
      const response = await post('/api/companies', { name: 'No Code' });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
      expect(response.json().details.issues[0].path).toBe('code');
    });

    it('400s an unexpected field rather than dropping it', async () => {
      const response = await post('/api/companies', {
        code: 'A',
        name: 'Alpha',
        id: 99,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('accounts (F1)', () => {
    beforeEach(async () => {
      await withSeed();
    });

    it('starts empty', async () => {
      const response = await get('/api/accounts');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accounts: [] });
    });

    it('records one and returns 201 with the allocated id', async () => {
      const response = await post('/api/accounts', {
        code: 'bank-hdfc',
        name: 'HDFC',
        type: 'bank',
        allowedCurrencies: ['INR'],
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().account).toMatchObject({
        id: 1,
        code: 'bank-hdfc',
        name: 'HDFC',
        type: 'bank',
        companyId: null,
        allowedCurrencies: ['INR'],
      });
    });

    it('lists an account no money has ever moved through', async () => {
      /*
        The whole reason this route exists next to `/api/accounts/balances`.
        Balances are derived from movements, so a brand-new account is absent
        from them — and a form asking where money went would have nothing to
        offer.
      */
      await post('/api/accounts', {
        code: 'bank-hdfc',
        name: 'HDFC',
        type: 'bank',
      });

      const listed = await get('/api/accounts');
      const balances = await get('/api/accounts/balances');

      expect(listed.json().accounts).toHaveLength(1);
      expect(balances.json().balances).toEqual([]);
    });

    it('narrows by type', async () => {
      await post('/api/accounts', { code: 'b', name: 'Bank', type: 'bank' });
      await post('/api/accounts', {
        code: 'w',
        name: 'Wallet',
        type: 'wallet',
      });

      const response = await get('/api/accounts?type=bank');

      expect(response.json().accounts).toHaveLength(1);
      expect(response.json().accounts[0].code).toBe('b');
    });

    it('links to a company', async () => {
      await post('/api/companies', { code: 'Rise001', name: 'Rise' });

      const response = await post('/api/accounts', {
        code: 'rise',
        name: 'Rise',
        type: 'processor',
        companyId: 1,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().account.companyId).toBe(1);
    });

    it('404s a company that does not exist, rather than a 500', async () => {
      // The FK would otherwise fail at insert time and surface as a server
      // fault, which is not what a wrong id is.
      const response = await post('/api/accounts', {
        code: 'rise',
        name: 'Rise',
        type: 'processor',
        companyId: 99,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'company_not_found' });
    });

    it('400s a currency the ledger does not know', async () => {
      // `account_currencies.currency_code` is an FK to `currencies`.
      const response = await post('/api/accounts', {
        code: 'kraken',
        name: 'Kraken',
        type: 'exchange',
        allowedCurrencies: ['XRP'],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'unknown_currency' });
    });

    it('409s a duplicate code, with the code in the detail', async () => {
      await post('/api/accounts', { code: 'a', name: 'A', type: 'wallet' });

      const response = await post('/api/accounts', {
        code: 'a',
        name: 'Again',
        type: 'bank',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'account_code_taken',
        details: { code: 'a' },
      });
    });

    it('400s a type the domain does not have', async () => {
      const response = await post('/api/accounts', {
        code: 'a',
        name: 'A',
        type: 'vault',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().details.issues[0].path).toBe('type');
    });

    it('treats an omitted allow-list as holding anything', async () => {
      const response = await post('/api/accounts', {
        code: 'multi',
        name: 'Multi',
        type: 'exchange',
      });

      expect(response.json().account.allowedCurrencies).toEqual([]);
    });

    it('400s an unexpected field rather than dropping it', async () => {
      const response = await post('/api/accounts', {
        code: 'a',
        name: 'A',
        type: 'bank',
        isMine: true,
      });

      expect(response.statusCode).toBe(400);
    });

    it('records a leg between two accounts it just created', async () => {
      /*
        The gap this route closes, end to end: on a fresh database, record a
        company, a payout, two accounts, and then a movement between them.
        Before this existed the last step was impossible without the legacy
        import.
      */
      await post('/api/companies', { code: 'Tradeify001', name: 'Tradeify' });
      await post('/api/accounts', {
        code: 'tradeify',
        name: 'Tradeify',
        type: 'prop_firm',
        companyId: 1,
        allowedCurrencies: ['USD'],
      });
      await post('/api/accounts', {
        code: 'rise',
        name: 'Rise',
        type: 'processor',
        allowedCurrencies: ['USD'],
      });
      await post('/api/payouts', {
        code: 'P1',
        companyId: 1,
        grossAmount: '1008.01',
        currencyCode: 'USD',
      });

      const response = await post('/api/transactions', {
        kind: 'payout_credit',
        code: 'T1',
        payoutId: 1,
        txnDate: '2025-03-10',
        fromAccountId: 1,
        toAccountId: 2,
        fromAmount: '1008.01',
        fromCurrencyCode: 'USD',
        toAmount: '907.22',
        toCurrencyCode: 'USD',
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('payouts (F2)', () => {
    beforeEach(async () => {
      await withSeed(seedCounterparties);
    });

    it('records a payout, keeping the amount exact', async () => {
      const response = await post('/api/payouts', {
        code: 'TradeifyPayout002',
        companyId: 1,
        payoutDate: '2025-04-02',
        grossAmount: '1008.01',
        currencyCode: 'USD',
        charges: '100.79',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().payout).toMatchObject({
        code: 'TradeifyPayout002',
        gross: { currency: 'USD', minor: '100801', amount: '1008.01' },
        charges: { currency: 'USD', minor: '10079', amount: '100.79' },
      });
    });

    it('rejects a gross amount of zero', async () => {
      const response = await post('/api/payouts', {
        code: 'Zero',
        companyId: 1,
        grossAmount: '0.00',
        currencyCode: 'USD',
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects an amount sent as a JSON number, not a string', async () => {
      // N1. A float64 would already have rounded before Money saw it.
      const response = await post('/api/payouts', {
        code: 'Float',
        companyId: 1,
        grossAmount: 1008.01,
        currencyCode: 'USD',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().details.issues[0].path).toBe('grossAmount');
    });

    it('rejects an amount in exponent notation', async () => {
      // §9 defect 3 is what Excel did with `1.43908E+19`.
      const response = await post('/api/payouts', {
        code: 'Exp',
        companyId: 1,
        grossAmount: '1.43908E+19',
        currencyCode: 'USD',
      });

      expect(response.statusCode).toBe(400);
    });

    it('404s an unknown company', async () => {
      const response = await post('/api/payouts', {
        code: 'Orphan',
        companyId: 999,
        grossAmount: '10.00',
        currencyCode: 'USD',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('company_not_found');
    });

    it('400s an unknown currency', async () => {
      const response = await post('/api/payouts', {
        code: 'Weird',
        companyId: 1,
        grossAmount: '10.00',
        currencyCode: 'XYZ',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('unknown_currency');
    });

    it('400s a malformed date', async () => {
      const response = await post('/api/payouts', {
        code: 'BadDate',
        companyId: 1,
        payoutDate: '02-04-2025',
        grossAmount: '10.00',
        currencyCode: 'USD',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().details.issues[0].path).toBe('payoutDate');
    });

    it('filters the list by company', async () => {
      await post('/api/payouts', {
        code: 'P1',
        companyId: 1,
        payoutDate: '2025-04-02',
        grossAmount: '10.00',
        currencyCode: 'USD',
      });

      const mine = await get('/api/payouts?companyId=1');
      const theirs = await get('/api/payouts?companyId=2');

      expect(mine.json().payouts).toHaveLength(1);
      expect(theirs.json().payouts).toHaveLength(0);
    });

    it('400s a half-given date range', async () => {
      const response = await get('/api/payouts?from=2025-04-01');

      expect(response.statusCode).toBe(400);
    });

    it('400s an unknown query parameter', async () => {
      const response = await get('/api/payouts?orderBy=whatever');

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/payouts/:id (F2)', () => {
    beforeEach(async () => {
      await withSeed(seedReferencePayout);
    });

    it('deletes the payout and says what went with it', async () => {
      const response = await del('/api/payouts/1');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        payout: { code: 'TradeifyPayout001' },
        transactionsDeleted: 13,
        feesDeleted: 16,
      });
    });

    it('leaves the list empty afterwards', async () => {
      await del('/api/payouts/1');

      const response = await get('/api/payouts');

      expect(response.json().payouts).toEqual([]);
    });

    it('takes the whole four-level tree, not just the root', async () => {
      await del('/api/payouts/1');

      const response = await get('/api/transactions');

      expect(response.json().transactions).toEqual([]);
    });

    it('empties the balances, because the movements are gone', async () => {
      // §10's ₹84,642.93 in the bank came entirely from this payout. F10 is
      // derived from movements, so deleting them has to leave nothing behind
      // — a balance outliving its legs is the spreadsheet bug all over again.
      await del('/api/payouts/1');

      const response = await get('/api/accounts/balances');

      expect(response.json().balances).toEqual([]);
    });

    it('404s a payout that is not there, and changes nothing', async () => {
      const response = await del('/api/payouts/999');

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('payout_not_found');

      const list = await get('/api/payouts');
      expect(list.json().payouts).toHaveLength(1);
    });

    it('400s an id that is not a row number', async () => {
      const response = await del('/api/payouts/not-a-number');

      expect(response.statusCode).toBe(400);
    });

    it('401s without a session, like every other data route', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: '/api/payouts/1',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('authentication_required');
    });
  });

  describe('the reference payout (§10)', () => {
    beforeEach(async () => {
      await withSeed(seedReferencePayout);
    });

    describe('GET /api/payouts/:id/settlement', () => {
      it('produces exactly the verified figures', async () => {
        const response = await get('/api/payouts/1/settlement');

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.grossProceeds).toMatchObject({
          currency: 'INR',
          minor: '8602756',
          amount: '86027.56',
        });
        expect(body.totalFees.amount).toBe('1384.63');
        expect(body.netCredited.amount).toBe('84642.93');
      });

      it('breaks the fees down by type, as §10 lists them', async () => {
        const body = (await get('/api/payouts/1/settlement')).json();

        expect(body.feesByType.tds.amount).toBe('868.88');
        expect(body.feesByType.exchange_fee.amount).toBe('437.09');
        expect(body.feesByType.gst.amount).toBe('78.66');
      });

      it('derives the status rather than reading a column', async () => {
        const body = (await get('/api/payouts/1/settlement')).json();

        expect(body.status).toBe('settled');
      });

      it('404s a payout that does not exist', async () => {
        const response = await get('/api/payouts/999/settlement');

        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('payout_not_found');
      });

      it('400s a non-numeric id', async () => {
        const response = await get('/api/payouts/abc/settlement');

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/payouts/:id/trail', () => {
      it('returns a nested tree, not a flat list', async () => {
        const body = (await get('/api/payouts/1/trail')).json();

        expect(body.roots).toHaveLength(1);
        expect(body.roots[0].children.length).toBeGreaterThan(0);
        // A grandchild proves it nests more than one level.
        const hasGrandchild = body.roots[0].children.some(
          (child: { children: unknown[] }) => child.children.length > 0,
        );
        expect(hasGrandchild).toBe(true);
      });

      it('carries fees and documents on the nodes that have them', async () => {
        const body = (await get('/api/payouts/1/trail')).json();

        const feeCount = countFees(body.roots);
        expect(feeCount).toBeGreaterThan(0);
      });

      it('serializes every amount as a string pair', async () => {
        const body = (await get('/api/payouts/1/trail')).json();

        expect(body.roots[0].transaction.fromAmount).toMatchObject({
          currency: expect.any(String),
          minor: expect.any(String),
          amount: expect.any(String),
        });
      });

      it('serializes a rate as a string, never a number', async () => {
        const body = (await get('/api/payouts/1/trail')).json();
        const rates = collectRates(body.roots);

        expect(rates.some((rate) => rate !== null)).toBe(true);
        for (const rate of rates) {
          expect(rate === null || typeof rate === 'string').toBe(true);
        }
      });

      it('never publishes the stored path of a document', async () => {
        const body = (await get('/api/payouts/1/trail')).json();

        expect(JSON.stringify(body)).not.toContain('storedPath');
      });

      it('404s an unknown payout', async () => {
        expect((await get('/api/payouts/999/trail')).statusCode).toBe(404);
      });
    });

    describe('GET /api/accounts/balances', () => {
      it('produces §10 balances, including both dust figures', async () => {
        const body = (await get('/api/accounts/balances')).json();

        const by = (code: string) =>
          body.balances.find(
            (one: { account: { code: string } }) => one.account.code === code,
          );

        expect(by('bank-hdfc').balance).toMatchObject({
          currency: 'INR',
          minor: '8464293',
          amount: '84642.93',
        });
        expect(by('coindcx').balance).toMatchObject({
          currency: 'USDT',
          minor: '1409080000',
          amount: '14.09080000',
        });
        expect(by('trustwallet').balance).toMatchObject({
          currency: 'USDT',
          minor: '133230000',
          amount: '1.33230000',
        });
      });

      it('narrows to one payout', async () => {
        const all = (await get('/api/accounts/balances')).json();
        const scoped = (await get('/api/accounts/balances?payoutId=1')).json();

        expect(scoped.balances).toHaveLength(all.balances.length);
      });
    });

    describe('GET /api/transactions', () => {
      it('lists the whole ledger', async () => {
        const body = (await get('/api/transactions')).json();

        expect(body.transactions).toHaveLength(13);
      });

      it('narrows by payout', async () => {
        const body = (await get('/api/transactions?payoutId=1')).json();

        expect(body.transactions).toHaveLength(13);
      });

      it('returns an empty list for a payout with no legs', async () => {
        const body = (await get('/api/transactions?payoutId=99')).json();

        expect(body.transactions).toEqual([]);
      });

      it('returns a long reference as text, never a number (§9 defect 3)', async () => {
        // Excel turning a long reference into a float is how §9's third
        // defect happened. Every reference column is TEXT, and it has to
        // survive JSON as text too.
        const body = (await get('/api/payouts?companyId=1')).json();

        expect(body.payouts[0].reference).toBe('FTDFYSLX50676373980');
        expect(typeof body.payouts[0].reference).toBe('string');
      });
    });

    describe('GET /api/data-quality (F11)', () => {
      it('returns the flagged rows', async () => {
        const response = await get('/api/data-quality');

        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.json().issues)).toBe(true);
      });

      it('accepts a tolerance', async () => {
        const response = await get('/api/data-quality?tolerancePct=0.5');

        expect(response.statusCode).toBe(200);
      });

      it('400s a tolerance outside 0-100', async () => {
        expect(
          (await get('/api/data-quality?tolerancePct=500')).statusCode,
        ).toBe(400);
      });
    });

    describe('GET /api/reports/financial-year (F13)', () => {
      it('totals the year and groups by company', async () => {
        // The reference payout is dated 2025-03-10, so it falls in the
        // Indian financial year ending 31 March 2025, not the one after.
        const response = await get(
          '/api/reports/financial-year?from=2024-04-01&to=2025-03-31',
        );

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.range).toEqual({ from: '2024-04-01', to: '2025-03-31' });
        expect(body.byCompany.length).toBeGreaterThan(0);
      });

      it('credits the §10 net to the company that paid it', async () => {
        const body = (
          await get('/api/reports/financial-year?from=2024-04-01&to=2025-03-31')
        ).json();

        expect(body.totalCredited.amount).toBe('84642.93');
        expect(body.totalTds.amount).toBe('868.88');
      });

      it('returns an empty year rather than an error', async () => {
        const body = (
          await get('/api/reports/financial-year?from=2023-04-01&to=2024-03-31')
        ).json();

        expect(body.byCompany).toEqual([]);
        expect(body.totalCredited.amount).toBe('0.00');
      });

      it('400s without a range', async () => {
        expect((await get('/api/reports/financial-year')).statusCode).toBe(400);
      });

      it('400s a range that runs backwards', async () => {
        const response = await get(
          '/api/reports/financial-year?from=2026-03-31&to=2025-04-01',
        );

        expect(response.statusCode).toBe(400);
      });
    });
  });

  describe('transactions (F3, F4)', () => {
    beforeEach(async () => {
      await withSeed(seedCounterparties);
      await post('/api/payouts', {
        code: 'P1',
        companyId: 1,
        payoutDate: '2025-03-16',
        grossAmount: '1008.01',
        currencyCode: 'USD',
      });
    });

    const transfer = (overrides: Record<string, unknown> = {}) => ({
      kind: 'transfer',
      code: 'T1',
      payoutId: 1,
      txnDate: '2025-03-16',
      fromAccountId: 3,
      toAccountId: 4,
      fromAmount: '222.44',
      fromCurrencyCode: 'USDT',
      toAmount: '222.44',
      toCurrencyCode: 'USDT',
      ...overrides,
    });

    it('records a movement', async () => {
      const response = await post('/api/transactions', transfer());

      expect(response.statusCode).toBe(201);
      expect(response.json().transaction).toMatchObject({
        code: 'T1',
        kind: 'transfer',
        fromAmount: { currency: 'USDT', minor: '22244000000' },
      });
    });

    it('400s the same from and to account (§7)', async () => {
      const response = await post(
        '/api/transactions',
        transfer({ toAccountId: 3 }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('same_account_transfer');
    });

    it('400s a rate on a same-currency move (§7)', async () => {
      const response = await post(
        '/api/transactions',
        transfer({ rate: '97.6652' }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('rate_on_same_currency');
    });

    it('400s a currency the destination cannot hold', async () => {
      const response = await post(
        '/api/transactions',
        transfer({
          toAccountId: 5,
          toCurrencyCode: 'USDT',
          fromCurrencyCode: 'USDT',
        }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('currency_not_allowed');
    });

    it('400s a parent from a different payout', async () => {
      await post('/api/transactions', transfer());
      await post('/api/payouts', {
        code: 'P2',
        companyId: 1,
        payoutDate: '2025-03-16',
        grossAmount: '500.00',
        currencyCode: 'USD',
      });

      const response = await post(
        '/api/transactions',
        transfer({ code: 'T2', payoutId: 2, parentId: 1 }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('parent_payout_mismatch');
    });

    it('400s an unknown kind', async () => {
      const response = await post(
        '/api/transactions',
        transfer({ kind: 'teleport' }),
      );

      expect(response.statusCode).toBe(400);
    });

    describe('a sale (UC3)', () => {
      const sale = (overrides: Record<string, unknown> = {}) => ({
        kind: 'sale',
        code: 'S1',
        payoutId: 1,
        txnDate: '2025-03-16',
        fromAccountId: 4,
        toAccountId: 5,
        fromAmount: '45.2292',
        fromCurrencyCode: 'USDT',
        rate: '97.6652',
        settlementCurrencyCode: 'INR',
        tds: '45.00',
        ...overrides,
      });

      it('computes gross proceeds from the rate, applies the schedule', async () => {
        const response = await post('/api/transactions', sale());

        expect(response.statusCode).toBe(201);
        const body = response.json();

        // 45.2292 USDT at 97.6652 is 441732 INR minor — the §10 figure.
        expect(body.grossProceeds).toMatchObject({
          currency: 'INR',
          minor: '441732',
          amount: '4417.32',
        });
      });

      it('derives the exchange fee and GST rather than accepting them', async () => {
        const body = (await post('/api/transactions', sale())).json();
        const byType = Object.fromEntries(
          body.fees.map(
            (fee: { feeType: string; amount: { amount: string } }) => [
              fee.feeType,
              fee.amount.amount,
            ],
          ),
        );

        // 50 bps of 4417.32 is 22.09; 1800 bps of 22.09 is 3.98.
        expect(byType['exchange_fee']).toBe('22.09');
        expect(byType['gst']).toBe('3.98');
        expect(byType['tds']).toBe('45.00');
      });

      it('requires a rate — a sale without one has no proceeds', async () => {
        const { rate: _rate, ...noRate } = sale();
        const response = await post('/api/transactions', noRate);

        expect(response.statusCode).toBe(400);
        expect(response.json().details.issues[0].path).toBe('rate');
      });

      it('rejects a toAmount, which it would only ignore', async () => {
        const response = await post(
          '/api/transactions',
          sale({ toAmount: '9999.99' }),
        );

        expect(response.statusCode).toBe(400);
      });

      it('rejects a rate with more than eight decimal places', async () => {
        const response = await post(
          '/api/transactions',
          sale({ rate: '97.665212345' }),
        );

        expect(response.statusCode).toBe(400);
      });
    });
  });

  describe('documents (F6, F7)', () => {
    beforeEach(async () => {
      await withSeed(seedReferencePayout);
    });

    const upload = (
      content: string,
      filename = 'statement.pdf',
      extra: Record<string, string> = {},
      transactionId = 3,
    ) => {
      const boundary = '----payouttest';
      const parts = Object.entries(extra)
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('');

      const body =
        parts +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/pdf\r\n\r\n' +
        `${content}\r\n` +
        `--${boundary}--\r\n`;

      return asUser(server, cookie, {
        method: 'POST',
        url: `/api/transactions/${String(transactionId)}/documents`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
    };

    it('attaches a file and returns 201', async () => {
      const response = await upload('a march statement');

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        created: true,
        document: { filename: 'statement.pdf', mimeType: 'application/pdf' },
      });
    });

    it('hashes the content, so the same bytes are one document', async () => {
      const first = await upload('identical bytes', 'one.pdf');
      const second = await upload('identical bytes', 'two.pdf');

      expect(first.json().created).toBe(true);
      expect(second.json().created).toBe(false);
      expect(second.json().document.id).toBe(first.json().document.id);
    });

    it('never returns the stored path', async () => {
      const response = await upload('a march statement');

      expect(response.body).not.toContain('storedPath');
    });

    it('404s an upload to a transaction that does not exist', async () => {
      // The database refuses the link with a FOREIGN KEY error; the adapter
      // turns that into a sentence, so the caller learns which id was wrong
      // instead of reading "something went wrong".
      const response = await upload('bytes', 'x.pdf', {}, 9999);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'transaction_not_found',
        details: { transactionId: 9999 },
      });
    });

    it('415s a request that is not multipart at all', async () => {
      // 415, not multipart's own 406: the body is fine, the media type is
      // the thing this route cannot take.
      const response = await asUser(server, cookie, {
        method: 'POST',
        url: '/api/transactions/3/documents',
        payload: { not: 'multipart' },
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().code).toBe('unsupported_media_type');
    });

    it('400s an unknown text field rather than ignoring it', async () => {
      const response = await upload('bytes', 'x.pdf', { unexpected: 'value' });

      expect(response.statusCode).toBe(400);
    });

    it('accepts a docType from the domain list', async () => {
      const response = await upload('bytes', 'x.pdf', { docType: 'statement' });

      expect(response.statusCode).toBe(201);
      expect(response.json().document.docType).toBe('statement');
    });

    it('400s a docType that is not in the domain list', async () => {
      const response = await upload('bytes', 'x.pdf', { docType: 'contract' });

      expect(response.statusCode).toBe(400);
    });

    describe('GET /api/documents/:id', () => {
      it('streams the bytes back exactly', async () => {
        const created = await upload('the exact bytes of a statement');
        const id = created.json().document.id;

        const response = await get(`/api/documents/${String(id)}`);

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('the exact bytes of a statement');
      });

      it('sends the stored mime type and the original filename', async () => {
        const created = await upload('bytes', 'coindcx-march.pdf');
        const id = created.json().document.id;

        const response = await get(`/api/documents/${String(id)}`);

        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe(
          'inline; filename="coindcx-march.pdf"',
        );
      });

      it('refuses to sniff the content type', async () => {
        const created = await upload('bytes');
        const id = created.json().document.id;

        const response = await get(`/api/documents/${String(id)}`);

        expect(response.headers['x-content-type-options']).toBe('nosniff');
      });

      it('quotes a filename with a space in it', async () => {
        const created = await upload('bytes', 'march statement.pdf');
        const id = created.json().document.id;

        const response = await get(`/api/documents/${String(id)}`);

        expect(response.headers['content-disposition']).toBe(
          'inline; filename="march statement.pdf"',
        );
      });

      it('404s an id that does not exist', async () => {
        const response = await get('/api/documents/999');

        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('document_not_found');
      });

      it('401s without a session — files are not public', async () => {
        // The whole reason this is a route and not a static mount.
        const created = await upload('secret statement');
        const id = created.json().document.id;

        const response = await server.app.inject({
          url: `/api/documents/${String(id)}`,
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).not.toContain('secret statement');
      });

      it('422s a row whose file is missing from the store', async () => {
        // A documents row can exist without its bytes — the legacy import
        // creates exactly that, from a sheet listing filenames and nothing
        // else. Inserted through the repository rather than raw SQL, which
        // §12 keeps in the adapter layer.
        const orphan = await new SqliteDocumentRepository(
          server.database,
        ).insert({
          filename: 'gone.pdf',
          storedPath: 'ab/cd/abcdef.pdf',
          mimeType: 'application/pdf',
          byteSize: 10,
          sha256: 'f'.repeat(64),
          docType: null,
          docDate: null,
          extractedText: null,
        });

        const response = await get(`/api/documents/${String(orphan.id)}`);

        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe('document_file_missing');
      });
    });

    describe('GET /api/documents/search', () => {
      it('finds a document by its filename', async () => {
        await upload('contents', 'coindcx-march-statement.pdf');

        const response = await get('/api/documents/search?q=coindcx');

        expect(response.statusCode).toBe(200);
        expect(response.json().documents).toHaveLength(1);
      });

      it('finds nothing for a word that is not there', async () => {
        await upload('contents', 'coindcx.pdf');

        const response = await get('/api/documents/search?q=kraken');

        expect(response.json().documents).toEqual([]);
      });

      it('treats punctuation as text, not as FTS5 syntax', async () => {
        const response = await get(
          `/api/documents/search?q=${encodeURIComponent('rise OR "')}`,
        );

        expect(response.statusCode).toBe(200);
      });

      it('400s an empty query', async () => {
        expect((await get('/api/documents/search?q=')).statusCode).toBe(400);
      });

      it('400s a missing query', async () => {
        expect((await get('/api/documents/search')).statusCode).toBe(400);
      });
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await withSeed();
    });

    it('404s an unknown route in the same shape as everything else', async () => {
      const response = await get('/api/nope');

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    });

    it('never leaks a stack trace', async () => {
      const response = await post('/api/payouts', {
        code: 'X',
        companyId: 999,
        grossAmount: '1.00',
        currencyCode: 'USD',
      });

      expect(response.body).not.toContain('at ');
      expect(response.body).not.toContain('.ts:');
      expect(response.json()).not.toHaveProperty('stack');
    });

    it('carries a domain error structured fields, not just prose', async () => {
      const response = await post('/api/payouts', {
        code: 'X',
        companyId: 999,
        grossAmount: '1.00',
        currencyCode: 'USD',
      });

      expect(response.json().details).toEqual({ companyId: 999 });
    });
  });
});

function countFees(nodes: { fees: unknown[]; children: unknown[] }[]): number {
  return nodes.reduce(
    (total, node) =>
      total +
      node.fees.length +
      countFees(node.children as { fees: unknown[]; children: unknown[] }[]),
    0,
  );
}

function collectRates(
  nodes: { transaction: { rate: string | null }; children: unknown[] }[],
): (string | null)[] {
  return nodes.flatMap((node) => [
    node.transaction.rate,
    ...collectRates(
      node.children as {
        transaction: { rate: string | null };
        children: unknown[];
      }[],
    ),
  ]);
}
