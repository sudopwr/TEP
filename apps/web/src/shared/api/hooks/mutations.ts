import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import {
  attachDocument,
  createAccount,
  createCompany,
  createPayout,
  createTransaction,
  deleteAccount,
  deletePayout,
  deleteTransaction,
  updateAccount,
  updateTransaction,
} from '../endpoints';
import { cachesAffectedByTransaction, queryKeys } from '../keys';
import type {
  AccountJson,
  CompanyJson,
  CreateAccountCommand,
  CreateCompanyCommand,
  CreatePayoutCommand,
  CreateSaleCommand,
  CreateTransactionCommand,
  DocumentAttachedJson,
  PayoutDeletedJson,
  PayoutJson,
  SaleRecordedJson,
  SettlementJson,
  TransactionDeletedJson,
  TransactionJson,
  UpdateAccountCommand,
  UpdateTransactionCommand,
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
 * F1 — a new account touches the account lists, and nothing else.
 *
 * Not the balances: those are derived from movements, and an account that has
 * just been created has none. Invalidating them would refetch a figure that
 * provably cannot have changed.
 */
export function useRecordAccount(): UseMutationResult<
  { account: AccountJson },
  Error,
  CreateAccountCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: createAccount,
    onSuccess: () => invalidateAll(client, [queryKeys.accounts.all()]),
  });
}

/**
 * F1 — correct an account.
 *
 * Wider than recording one, and each for a reason the server can prove:
 *
 *   - the account lists, obviously;
 *   - the **balances**, which embed the whole account (`accountBalance`
 *     serialises it), so a renamed exchange is a stale row on that screen;
 *   - the **data-quality checks**, because narrowing an allow-list is exactly
 *     what turns an existing leg into §7's "currency not allowed" — the edit
 *     does not move any money and still changes what is flagged.
 *
 * Not the trails or the settlements: a trail node carries the transaction and
 * its account *ids*, never a name, so nothing there can have gone stale.
 */
export function useEditAccount(): UseMutationResult<
  { account: AccountJson },
  Error,
  UpdateAccountCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: updateAccount,
    onSuccess: () =>
      invalidateAll(client, [
        queryKeys.accounts.all(),
        queryKeys.balances.all(),
        queryKeys.dataQuality.all(),
      ]),
  });
}

/**
 * F1 — remove an account nothing has moved through.
 *
 * Only the account lists. An account the server agreed to delete had no legs
 * at all — that is the condition, and it 409s otherwise — so the balances and
 * the checks, both derived from movements, provably cannot have changed.
 * Invalidating them anyway would be a refetch of two screens to display the
 * same figures, and would blur why the edit above touches them.
 */
export function useDeleteAccount(): UseMutationResult<
  { account: AccountJson },
  Error,
  number
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => invalidateAll(client, [queryKeys.accounts.all()]),
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
 * F2 — delete a payout, with its legs, their fees and its document links.
 *
 * The one mutation that **removes** cache entries rather than invalidating
 * them. Invalidating `payouts.detail(id)` would send the screen straight back
 * to the server for a trail and a settlement belonging to a payout that no
 * longer exists, and the reader would watch the row they just deleted be
 * replaced by two red boxes explaining that it is missing. Removing is the
 * truthful move: there is nothing to re-read.
 *
 * Everything else is invalidated rather than removed, because it still
 * exists and is now wrong: the payout lists, the ledger-wide transaction
 * lists, the balances (money that never moved is money the totals counted),
 * the data-quality checks (§7's flagged rows were partly this payout's), and
 * the financial-year report, which is the one place a *deleted* payout
 * changes a figure nobody is looking at — `cachesAffectedByTransaction` does
 * not name it because recording a leg cannot change what a payout credited.
 */
export function useDeletePayout(): UseMutationResult<
  PayoutDeletedJson,
  Error,
  number
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: deletePayout,
    onSuccess: async (_result, payoutId) => {
      client.removeQueries({ queryKey: queryKeys.payouts.detail(payoutId) });

      await invalidateAll(client, [
        queryKeys.payouts.lists(),
        queryKeys.transactions.all(),
        queryKeys.balances.all(),
        queryKeys.dataQuality.all(),
        queryKeys.reports.all(),
      ]);
    },
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

/**
 * F21 — correct a leg.
 *
 * The same blast radius as recording or deleting one, and for the same
 * reason: `cachesAffectedByTransaction` names everything derived from a leg,
 * and an edit changes the same derivations a new leg would — the trail, the
 * settlement, the balances and §7's checks, which matter most here, since an
 * edited sale can leave its fees off §8's schedule.
 *
 * `payoutId` comes from the server's answer rather than the caller's copy:
 * the payout is carried forward by the use case, so the row that comes back
 * is the authority on which trail is now wrong.
 */
export function useEditTransaction(): UseMutationResult<
  { transaction: TransactionJson },
  Error,
  UpdateTransactionCommand
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: updateTransaction,
    onSuccess: (result) =>
      invalidateAll(
        client,
        cachesAffectedByTransaction(result.transaction.payoutId),
      ),
  });
}

/**
 * F20 — delete a leg and the legs below it.
 *
 * Exactly `cachesAffectedByTransaction`, the same list recording one uses:
 * removing a leg changes that payout's trail and settlement, the ledger-wide
 * transaction lists, the balances (money that never moved) and the checks
 * (§7's flagged rows were partly this leg's). And the same exclusions — the
 * payouts list carries gross, charges and reference, which no leg touches.
 *
 * `payoutId` comes from the **server's answer**, not from a caller who might
 * have passed a stale one: it is the payout the deleted row actually belonged
 * to, which is the only one whose trail is now wrong.
 */
export function useDeleteTransaction(): UseMutationResult<
  TransactionDeletedJson,
  Error,
  number
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: deleteTransaction,
    onSuccess: (result) =>
      invalidateAll(client, cachesAffectedByTransaction(result.payoutId)),
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
