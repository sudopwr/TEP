import type { Readable } from 'node:stream';

import type {
  AttachDocument,
  AuthenticateSession,
  ChangeCredentials,
  DeleteAccount,
  DeleteDocument,
  DetachDocument,
  DeletePayout,
  DeleteTransaction,
  GenerateFinancialYearReport,
  GetAccountBalances,
  GetDocument,
  GetPayoutTrail,
  EditAccount,
  EditTransaction,
  LinkDocument,
  ListDocuments,
  ListDocumentsFor,
  GetSettlement,
  ListAccounts,
  ListCompanies,
  ListPayouts,
  ListTraders,
  LookUpChainTransfer,
  ListTransactions,
  RecordAccount,
  RecordCompany,
  RecordPayout,
  RecordSale,
  EditTrader,
  RecordTrader,
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

/** What an archive says about itself. `files` counts bytes, not rows. */
export interface ArchiveSummary {
  readonly format: string;
  readonly version: number;
  readonly createdAt: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly files: { readonly included: number; readonly missing: number };
}

export interface WrittenArchive {
  /** What the download should be called. */
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: ArchiveSummary;
}

export interface RestoredArchive {
  readonly manifest: ArchiveSummary;
  readonly counts: Readonly<Record<string, number>>;
  readonly filesRestored: number;
  /** What the ledger held before the import replaced it. */
  readonly replaced: Readonly<Record<string, number>>;
}

/**
 * F33 — the ledger in and out of one file, as the route sees it.
 *
 * Named here for the same reason `DocumentFileSource` is: the route needs to
 * export a ledger without learning that there is a SQLite database and a
 * `data/files` directory behind it, and `ledger-archive.ts` satisfies this
 * shape structurally rather than either file importing the other.
 *
 * Not a use case, and not in core. It is three things core cannot have — SQL
 * over whole tables, gzip, and the filesystem — with no domain rule of its own
 * beyond the ones every entity already enforces on the way back in. Putting it
 * on `UseCases` would mean a port whose only implementation is this one, which
 * §5 says is not a port.
 */
export interface LedgerTransfer {
  toArchive(now?: Date): Promise<WrittenArchive>;
  fromArchive(
    archive: Uint8Array,
    options?: { readonly replace?: boolean },
  ): Promise<RestoredArchive>;
  /** What is on file now, for a screen that is about to offer to replace it. */
  counts(): Readonly<Record<string, number>>;
}

export interface UseCases {
  readonly recordCompany: RecordCompany;
  readonly listCompanies: ListCompanies;

  readonly recordTrader: RecordTrader;
  readonly editTrader: EditTrader;
  readonly listTraders: ListTraders;
  readonly lookUpChainTransfer: LookUpChainTransfer;

  readonly recordAccount: RecordAccount;
  readonly editAccount: EditAccount;
  readonly deleteAccount: DeleteAccount;
  readonly listAccounts: ListAccounts;
  readonly recordPayout: RecordPayout;
  readonly deletePayout: DeletePayout;
  readonly listPayouts: ListPayouts;
  readonly getPayoutTrail: GetPayoutTrail;
  readonly getSettlement: GetSettlement;
  readonly recordTransaction: RecordTransaction;
  readonly editTransaction: EditTransaction;
  readonly deleteTransaction: DeleteTransaction;
  readonly recordSale: RecordSale;
  readonly listTransactions: ListTransactions;
  readonly attachDocument: AttachDocument;
  readonly getDocument: GetDocument;
  readonly deleteDocument: DeleteDocument;
  readonly linkDocument: LinkDocument;
  readonly detachDocument: DetachDocument;
  readonly listDocuments: ListDocuments;
  readonly listDocumentsFor: ListDocumentsFor;
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
    /** F33's export and import, as one object. */
    ledgerTransfer: LedgerTransfer;
  }
}
