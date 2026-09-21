import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import {
  documentUrl,
  useAccountBalances,
  useDeleteTransaction,
  usePayoutTrail,
  type AccountJson,
  type DocumentJson,
  type MoneyJson,
  type TrailNodeJson,
  type TransactionFeeJson,
  type TransactionJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  MoneyDisplay,
  TreeView,
  formatMinor,
} from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { EditTransactionDialog } from './EditTransactionDialog';

/**
 * F8 — the money trail, as a tree. The screen this application exists for.
 *
 * What it has to make possible: starting at $1,008.01 awarded by Tradeify and
 * arriving at the rupees in the bank, reading every hop in between and seeing
 * where each one went. §10's payout is four levels deep, splits four ways and
 * loses money at nine of its thirteen nodes — so the layout is the whole
 * problem.
 *
 * **Two columns, and only the left one indents.** The generic `TreeView` takes
 * a label and an aside, and renders the aside outside the indentation on
 * purpose. Nesting the amounts too would push each level's figures right by
 * twenty pixels, and a column of money that steps sideways as it descends is
 * unreadable in exactly the place it matters — comparing what a leg received
 * against what its parent sent.
 *
 * **Both currencies on every leg.** A withdrawal is 226.81 USD *and*
 * 222.78 USDT; showing one of them makes the reader do the conversion they
 * came here to check. The rate that connects the two sits directly
 * underneath, at full precision.
 *
 * **Fees hang off the leg that paid them.** Fee rows are per transaction and
 * in their own currency — the network fee is USD on a withdrawal, TDS is INR
 * on a sale. Rolling them into one total would hide the thing §8 is about:
 * four withdrawals paid $16.31 in flat fees where one would have paid $4.03,
 * and that is only visible when you can see four of them.
 *
 * `TreeView` itself knows none of this. It takes nodes, a `childrenOf` and
 * two render props; everything transaction-shaped is below.
 */

export interface TransactionTreeProps {
  readonly payoutId: number;
  /**
   * Attach a document to one leg, and take one off again (F23).
   *
   * Callbacks rather than components, because N8 forbids `transactions/`
   * from importing `documents/`: the trail renders what is attached, and
   * what can be *done* about it arrives from the composition root (§5),
   * which owns the one dialog both features share. Omit them and the tree is
   * the read-only trail it has always been — which is what its own tests
   * render.
   */
  readonly onAttachDocument?: (transaction: TransactionJson) => void;
  readonly onRemoveDocument?: (
    transaction: TransactionJson,
    document: DocumentJson,
  ) => void;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  payout_credit: 'credit',
  withdrawal: 'withdrawal',
  transfer: 'transfer',
  sale: 'sale',
  deposit: 'deposit',
};

const FEE_LABELS: Readonly<Record<string, string>> = {
  tds: 'TDS',
  exchange_fee: 'Exchange fee',
  gst: 'GST',
  network_fee: 'Network fee',
  platform_charge: 'Platform charge',
};

/** `2025-03-11` as `11 Mar`. The year belongs to the payout, not every leg. */
function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return iso;
  }

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function accountName(
  accounts: ReadonlyMap<number, AccountJson>,
  id: number,
): string {
  // A numbered fallback rather than a blank: an unnamed account is still a
  // different account from the one above it, and the reader must see that.
  return accounts.get(id)?.name ?? `Account ${String(id)}`;
}

function Amount({
  value,
  tone,
}: {
  readonly value: MoneyJson;
  readonly tone?: 'negative';
}) {
  return (
    <MoneyDisplay
      minor={value.minor}
      currency={value.currency}
      showCurrency
      {...(tone === undefined ? {} : { tone })}
    />
  );
}

/** The label column: what happened, between which accounts, and what to do. */
function LegLabel({
  transaction,
  accounts,
  onEdit,
  onDelete,
  onAttach,
}: {
  readonly transaction: TransactionJson;
  readonly accounts: ReadonlyMap<number, AccountJson>;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onAttach?: (() => void) | undefined;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="numeric" sx={{ fontWeight: 600 }}>
          {accountName(accounts, transaction.fromAccountId)}
        </Typography>
        <Box component="span" aria-hidden sx={{ color: 'muted.main' }}>
          →
        </Box>
        <Typography variant="numeric" sx={{ fontWeight: 600 }}>
          {accountName(accounts, transaction.toAccountId)}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'muted.main' }}>
          {KIND_LABELS[transaction.kind] ?? transaction.kind} ·{' '}
          {shortDate(transaction.txnDate)} · {transaction.code}
        </Typography>

        {/*
          Named for the leg, not just "Edit" and "Delete": thirteen rows share
          a screen, and a screen reader moving between them would otherwise
          hear the same two words thirteen times with no way to tell which row
          it is on. It also gives every test an unambiguous handle.
        */}
        <Button
          size="small"
          color="inherit"
          aria-label={`Edit ${transaction.code}`}
          onClick={onEdit}
          sx={{ minWidth: 0, px: 0.75, py: 0, color: 'muted.main' }}
        >
          Edit
        </Button>
        {onAttach === undefined ? null : (
          <Button
            size="small"
            color="inherit"
            aria-label={`Attach a document to ${transaction.code}`}
            onClick={onAttach}
            sx={{ minWidth: 0, px: 0.75, py: 0, color: 'muted.main' }}
          >
            Attach
          </Button>
        )}
        <Button
          size="small"
          color="error"
          aria-label={`Delete ${transaction.code}`}
          onClick={onDelete}
          sx={{ minWidth: 0, px: 0.75, py: 0 }}
        >
          Delete
        </Button>
      </Box>
    </Box>
  );
}

function FeeLines({ fees }: { readonly fees: readonly TransactionFeeJson[] }) {
  if (fees.length === 0) return null;

  return (
    <Box sx={{ mt: 0.25 }}>
      {fees.map((fee) => (
        <Box
          key={fee.id}
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'baseline',
            gap: 1,
          }}
        >
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            less {FEE_LABELS[fee.feeType] ?? fee.feeType}
          </Typography>
          <Amount value={fee.amount} tone="negative" />
        </Box>
      ))}
    </Box>
  );
}

function DocumentLines({
  documents,
  onRemove,
}: {
  readonly documents: readonly DocumentJson[];
  readonly onRemove?: (document: DocumentJson) => void;
}) {
  if (documents.length === 0) return null;

  return (
    <Box sx={{ mt: 0.25 }}>
      {documents.map((document) => (
        <Box
          key={document.id}
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'baseline',
            gap: 0.5,
          }}
        >
          <Link
            // Served by the handler, behind both guards — never a static mount
            // (§13). Same-origin, so the session cookie goes with it.
            href={documentUrl(document.id)}
            target="_blank"
            rel="noreferrer"
            variant="body2"
            sx={{ color: 'muted.main' }}
          >
            {document.filename}
          </Link>

          {onRemove === undefined ? null : (
            <Button
              size="small"
              color="inherit"
              // Named for the file: a leg may carry several, and "Remove"
              // four times tells a screen reader nothing about which.
              aria-label={`Remove ${document.filename}`}
              onClick={() => {
                onRemove(document);
              }}
              sx={{ minWidth: 0, px: 0.5, py: 0, color: 'muted.main' }}
            >
              Remove
            </Button>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** The aside: the amounts, the rate that connects them, and what was taken. */
function LegAmounts({
  node,
  onRemoveDocument,
}: {
  readonly node: TrailNodeJson;
  readonly onRemoveDocument?: (document: DocumentJson) => void;
}) {
  const { transaction } = node;
  const crossCurrency =
    transaction.fromAmount.currency !== transaction.toAmount.currency;

  return (
    <Box sx={{ textAlign: 'right', minWidth: 280 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'baseline',
          gap: 1,
        }}
      >
        <Amount value={transaction.fromAmount} />
        <Box component="span" aria-hidden sx={{ color: 'muted.main' }}>
          →
        </Box>
        <Amount value={transaction.toAmount} />
      </Box>

      {transaction.rate === null ? null : (
        <Typography variant="body2" sx={{ color: 'muted.main' }}>
          {/*
            Full precision, never rounded for display. §6 stores a rate scaled
            by 1e8, and the eighth decimal is the difference between a trail
            that reconciles and one that is a rupee out — which is the kind of
            discrepancy this screen exists to surface.
          */}
          at {formatMinor(transaction.rate, 8)}
          {crossCurrency
            ? ` ${transaction.toAmount.currency} per ${transaction.fromAmount.currency}`
            : ''}
        </Typography>
      )}

      <FeeLines fees={node.fees} />
      <DocumentLines
        documents={node.documents}
        {...(onRemoveDocument === undefined
          ? {}
          : { onRemove: onRemoveDocument })}
      />
    </Box>
  );
}

/** The leg and everything under it, counted from the tree already on screen. */
function subtreeSize(node: TrailNodeJson): number {
  return node.children.reduce((total, child) => total + subtreeSize(child), 1);
}

export function TransactionTree({
  payoutId,
  onAttachDocument,
  onRemoveDocument,
}: TransactionTreeProps) {
  const trail = usePayoutTrail(payoutId);
  const remove = useDeleteTransaction();
  const { notify } = useToast();

  /*
    The node being deleted, not its id.

    The dialog has to name the leg and count what hangs off it, and the count
    lives in the tree rather than in a request: the trail is already loaded,
    and asking the server how much a delete would take would be a second
    endpoint answering a question this screen can already see.
  */
  const [deleting, setDeleting] = useState<TrailNodeJson | null>(null);
  const [editing, setEditing] = useState<TransactionJson | null>(null);

  /*
    Account *names* come from the balances endpoint, because there is no
    `GET /api/accounts`. That is sound here and nowhere else: every account a
    transaction names has by definition taken part in a movement, so it has a
    balance and appears in this list. A form offering accounts to choose from
    cannot make the same assumption — see `RecordTransactionForm`.
  */
  const balances = useAccountBalances();

  const accounts = useMemo(() => {
    const byId = new Map<number, AccountJson>();

    for (const entry of balances.data ?? []) {
      byId.set(entry.account.id, entry.account);
    }

    return byId;
  }, [balances.data]);

  if (trail.isPending) {
    return (
      <Box aria-busy="true" aria-label="Loading the money trail">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" height={32} />
        ))}
      </Box>
    );
  }

  if (trail.isError) {
    const failure = describeError(trail.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void trail.refetch();
        }}
      />
    );
  }

  const { payout, roots } = trail.data;

  // Everything under the leg in question, itself excluded: the sentence is
  // about what *else* goes.
  const below = deleting === null ? 0 : subtreeSize(deleting) - 1;

  if (roots.length === 0) {
    return (
      <EmptyState
        message="This payout has no movements yet."
        hint="Record the credit that started it, then the withdrawals and the sale that follow."
      />
    );
  }

  return (
    <Box>
      {/*
        The top of the chain, so the tree anchors at the award itself rather
        than at whichever leg happens to come first.
      */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 2,
          pb: 1,
          mb: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="label" component="h3">
          Awarded
        </Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Amount value={payout.gross} />
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            less platform charges{' '}
            <MoneyDisplay
              minor={payout.charges.minor}
              currency={payout.charges.currency}
              showCurrency
              tone="negative"
            />
          </Typography>
        </Box>
      </Box>

      <TreeView<TrailNodeJson>
        nodes={roots}
        childrenOf={(node) => node.children}
        keyOf={(node) => node.transaction.id}
        ariaLabel={`Money trail for ${payout.code}`}
        renderNode={(node) => (
          <LegLabel
            transaction={node.transaction}
            accounts={accounts}
            onEdit={() => {
              setEditing(node.transaction);
            }}
            onDelete={() => {
              setDeleting(node);
            }}
            onAttach={
              onAttachDocument === undefined
                ? undefined
                : () => {
                    onAttachDocument(node.transaction);
                  }
            }
          />
        )}
        renderAside={(node) => (
          <LegAmounts
            node={node}
            {...(onRemoveDocument === undefined
              ? {}
              : {
                  onRemoveDocument: (document: DocumentJson) => {
                    onRemoveDocument(node.transaction, document);
                  },
                })}
          />
        )}
      />

      <EditTransactionDialog
        transaction={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={(saved) => {
          setEditing(null);
          notify(`${saved.code} saved`);
        }}
      />

      {/*
        One dialog for the whole tree, holding whichever leg was asked about.
        Thirteen mounted dialogs would be thirteen copies of the same question.
      */}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.transaction.code ?? 'this leg'}?`}
        message={
          <>
            {below === 0
              ? 'Nothing hangs off it. Its fees go with it; documents attached to it stay on file.'
              : `The ${String(below)} ${below === 1 ? 'leg' : 'legs'} below it go too — a leg records money that arrived from this one, and cannot outlive it. Fees go with them; documents stay on file.`}
            {remove.error === null ? null : (
              <Box sx={{ mt: 2 }}>
                <ErrorState message={describeError(remove.error).message} />
              </Box>
            )}
          </>
        }
        confirmLabel="Delete leg"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (deleting === null || remove.isPending) return;

          remove.mutate(deleting.transaction.id, {
            onSuccess: (result) => {
              setDeleting(null);
              notify(
                result.transactionsDeleted === 1
                  ? `${result.transaction.code} deleted`
                  : `${result.transaction.code} and ${String(result.transactionsDeleted - 1)} below it deleted`,
              );
            },
          });
        }}
        onCancel={() => {
          setDeleting(null);
          remove.reset();
        }}
      />
    </Box>
  );
}
