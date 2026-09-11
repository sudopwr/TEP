import type { Readable } from 'node:stream';

import type {
  AttachDocument,
  AuthenticateSession,
  ChangeCredentials,
  GenerateFinancialYearReport,
  GetAccountBalances,
  GetDocument,
  GetPayoutTrail,
  GetSettlement,
  ListCompanies,
  ListPayouts,
  ListTransactions,
  RecordCompany,
  RecordPayout,
  RecordSale,
  RecordTransaction,
  RunDataQualityChecks,
  SearchDocuments,
  SignIn,
  SignOut,
} from '@payout/core';

/**
 * What a route may reach for, and nothing else.
 *
 * This file names types only. It imports no adapter and constructs nothing,
 * which is what lets `container.ts` remain the single place that knows both
 * halves: the container builds these and calls `fastify.decorate`, the routes
 * read them off the instance, and neither one imports the other's world.
 *
 * It is also the swap point. A test that wants a fake use case decorates the
 * same name with a different object; the routes cannot tell and do not care.
 */

/**
 * Opening a file for streaming — deliberately not a core port.
 *
 * §5: "Ports earn their existence. Create an interface only where a fake is
 * needed in tests or a second implementation genuinely exists." Core already
 * has `DocumentStore`, and it cannot grow a streaming method: a `Readable` is
 * `node:stream`, and core imports nothing. So this lives here, in apps/api,
 * where Node is allowed, and the filesystem store satisfies it structurally.
 */
export interface DocumentFileSource {
  /**
   * A stream of the file's bytes.
   *
   * A stream and not a Buffer: a 40MB statement read into memory to be handed
   * to `reply.send` occupies it twice and holds both until the socket drains.
   */
  openReadStream(storedPath: string): Readable;
}

export interface UseCases {
  readonly recordCompany: RecordCompany;
  readonly listCompanies: ListCompanies;
  readonly recordPayout: RecordPayout;
  readonly listPayouts: ListPayouts;
  readonly getPayoutTrail: GetPayoutTrail;
  readonly getSettlement: GetSettlement;
  readonly recordTransaction: RecordTransaction;
  readonly recordSale: RecordSale;
  readonly listTransactions: ListTransactions;
  readonly attachDocument: AttachDocument;
  readonly getDocument: GetDocument;
  readonly searchDocuments: SearchDocuments;
  readonly getAccountBalances: GetAccountBalances;
  readonly runDataQualityChecks: RunDataQualityChecks;
  readonly generateFinancialYearReport: GenerateFinancialYearReport;
  readonly signIn: SignIn;
  readonly signOut: SignOut;
  readonly authenticate: AuthenticateSession;
  readonly changeCredentials: ChangeCredentials;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every use case, injected by the container. */
    useCases: UseCases;
    /** Bytes on their way out, by stored path. */
    documentFiles: DocumentFileSource;
  }
}
