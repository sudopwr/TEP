import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import {
  attachDocument,
  createCompany,
  createPayout,
  createTransaction,
} from '../endpoints';
import { cachesAffectedByTransaction, queryKeys } from '../keys';
import type {
  CompanyJson,
  CreateCompanyCommand,
  CreatePayoutCommand,
  CreateSaleCommand,
  CreateTransactionCommand,
  DocumentAttachedJson,
  PayoutJson,
  SaleRecordedJson,
  SettlementJson,
  TransactionJson,
} from '../types';

/**
 * Writes, and exactly which caches each one invalidates.
 *
 * "Precisely" is the whole design here. `queryClient.invalidateQueries()` with
 * no key refetches everything on screen and is always correct, which is why it
 * is so tempting and so wrong: on a table of a few thousand rows it turns one
 * write into a full reload, and it hides the question of what actually
 * changed. Every mutation below names its blast radius, and a test asserts
 * what stays untouched.
 */

/** Fire every invalidation in parallel and wait for them all. */
function invalidateAll(
  client: QueryClient,
  keys: readonly (readonly unknown[])[],
): Promise<void> {
  return Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey })),
  ).then(() => undefined);
}

/** F1 — a new company touches the company list and nothing else. */
export function useRecordCompany(): UseMutationResult<
  { company: CompanyJson },
  Error,
  CreateCompanyCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: createCompany,
    onSuccess: () => invalidateAll(client, [queryKeys.companies.all()]),
  });
}

/**
 * F2 — a new payout touches the payout lists.
 *
 * Not `payouts.all()`: that prefix also covers `['payouts', 7, ...]`, and a
 * brand-new payout has not changed payout 7's trail or settlement. Only the
 * lists need re-reading.
 */
export function useRecordPayout(): UseMutationResult<
  { payout: PayoutJson },
  Error,
  CreatePayoutCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: createPayout,
    onSuccess: () => invalidateAll(client, [queryKeys.payouts.lists()]),
  });
}

/**
 * F3/F4 — record one leg of the tree.
 *
 * Invalidates that payout's trail and settlement, the transaction lists, the
 * balances and the data-quality checks. Nothing else: see
 * `cachesAffectedByTransaction` for why the payout *list* is not in there.
 */
export function useRecordTransaction(): UseMutationResult<
  { transaction: TransactionJson } | SaleRecordedJson,
  Error,
  CreateTransactionCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (command: CreateTransactionCommand) =>
      createTransaction(command),
    onSuccess: (_result, command) =>
      invalidateAll(client, cachesAffectedByTransaction(command.payoutId)),
  });
}

/** What `onMutate` hands to `onError` so a failure can be undone. */
interface SettleRollback {
  readonly previous: readonly [
    readonly unknown[],
    SettlementJson | undefined,
  ][];
}

/**
 * Settle a payout, optimistically.
 *
 * **On the name.** There is no "mark settled" endpoint, and there should not
 * be: §13 says status is derived and never stored, and `Payout.status()`
 * computes it from whether a sale leg reached a bank account. So settling a
 * payout *is* recording that final sale — this hook does exactly that, and
 * optimistically flips the cached settlement to `settled` while the server
 * works.
 *
 * **Why this mutation and not another.** It is the one write whose visible
 * outcome is knowable before the server answers. Recording an ordinary
 * transfer tells you nothing you can predict; recording the sale that lands
 * INR in the bank has one certain consequence — the payout is now settled —
 * next to several the server must compute (the exchange fee, the GST, the
 * net). So the status flips immediately and the figures wait. Optimistically
 * guessing the *amounts* would be the version of this that lies: a fee
 * schedule the browser does not have, rendered as fact.
 *
 * The full shape, because half an optimistic update is worse than none:
 *
 *   1. cancel in-flight settlement reads, or one could land after the
 *      optimistic write and undo it;
 *   2. snapshot every settlement entry for this payout;
 *   3. write the optimistic status through all of them;
 *   4. on error, restore the snapshot exactly;
 *   5. on settle — success or failure — invalidate, so the server's answer
 *      replaces the guess either way.
 */
export function useSettlePayout(): UseMutationResult<
  SaleRecordedJson,
  Error,
  CreateSaleCommand,
  SettleRollback
> {
  const client = useQueryClient();

  return useMutation<
    SaleRecordedJson,
    Error,
    CreateSaleCommand,
    SettleRollback
  >({
    mutationFn: (command: CreateSaleCommand) => createTransaction(command),

    onMutate: async (command) => {
      const prefix = queryKeys.payouts.settlements(command.payoutId);

      // (1) A read already in flight would resolve with the old status and
      // overwrite the optimistic one. Cancelling is not optional.
      await client.cancelQueries({ queryKey: prefix });

      // (2) Snapshot before touching anything.
      const previous = client.getQueriesData<SettlementJson>({
        queryKey: prefix,
      });

      // (3) Every currency variant of this payout's settlement.
      client.setQueriesData<SettlementJson>({ queryKey: prefix }, (current) =>
        current === undefined ? current : { ...current, status: 'settled' },
      );

      return { previous };
    },

    // (4) Put back exactly what was there, entry by entry. Not a refetch:
    // a refetch would leave the wrong status on screen until it landed.
    onError: (_error, _command, context) => {
      for (const [key, snapshot] of context?.previous ?? []) {
        client.setQueryData(key, snapshot);
      }
    },

    // (5) Either way the server is the authority on what the totals are.
    onSettled: (_data, _error, command) =>
      invalidateAll(client, cachesAffectedByTransaction(command.payoutId)),
  });
}

/**
 * F6 — attach a file to a transaction.
 *
 * Only the trail carries documents, so only the trail is invalidated, plus
 * the searches, since a new filename is newly findable. Balances and
 * settlement are untouched: a document moves no money.
 */
export function useAttachDocument(): UseMutationResult<
  DocumentAttachedJson,
  Error,
  {
    readonly payoutId: number;
    readonly transactionId: number;
    readonly file: File;
    readonly docType?: string;
    readonly docDate?: string;
    readonly role?: string;
  }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ payoutId: _payoutId, ...input }) => attachDocument(input),
    onSuccess: (_result, { payoutId }) =>
      invalidateAll(client, [
        queryKeys.payouts.trail(payoutId),
        queryKeys.documents.all(),
      ]),
  });
}
