import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

import {
  useAccounts,
  useEditTransaction,
  type AccountJson,
  type TransactionJson,
} from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { AmountField, ErrorState, formatMinor } from '../../shared/components';

/**
 * F21 — correct a leg, in place on the trail it was read from.
 *
 * The fields are the leg itself and nothing else. Its **kind**, its
 * **parent** and its **payout** are not here, each for a reason
 * `EditTransaction` gives in full: changing kind would mean running §8's fee
 * engine, re-parenting restructures the tree, and moving a leg between
 * payouts re-files a subtree. Nor are the **fees** — TDS came off a statement
 * and is the only authority for what was withheld.
 *
 * Which leaves one consequence the dialog says out loud rather than hiding:
 * editing a sale's amounts can leave its fees no longer matching the
 * schedule, and §7 puts that in the data-quality checks — suspicious rather
 * than impossible. The reader should know the flag is coming before they save,
 * not discover it on another screen.
 */

export interface EditTransactionDialogProps {
  /** The leg to edit. `null` closes the dialog. */
  readonly transaction: TransactionJson | null;
  readonly onClose: () => void;
  readonly onSaved: (transaction: TransactionJson) => void;
}

/** The leg's own currency included, even if the account no longer allows it. */
function currencyOptions(
  account: AccountJson | undefined,
  current: string,
): readonly string[] {
  const allowed = account?.allowedCurrencies ?? [];

  return allowed.includes(current) ? allowed : [current, ...allowed];
}

export function EditTransactionDialog({
  transaction,
  onClose,
  onSaved,
}: EditTransactionDialogProps) {
  return (
    <Dialog
      open={transaction !== null}
      onClose={onClose}
      aria-labelledby="edit-transaction-title"
      maxWidth="sm"
      fullWidth
    >
      {/*
        Keyed by the leg and mounted only while one is open, so the fields
        start from the row that was clicked every time — no effect copying
        nine values across, and no leftovers from the last leg.
      */}
      {transaction === null ? null : (
        <EditTransactionForm
          key={transaction.id}
          transaction={transaction}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function EditTransactionForm({
  transaction,
  onClose,
  onSaved,
}: {
  readonly transaction: TransactionJson;
  readonly onClose: () => void;
  readonly onSaved: (transaction: TransactionJson) => void;
}) {
  const accounts = useAccounts();
  const edit = useEditTransaction();

  const [code, setCode] = useState(transaction.code);
  const [txnDate, setTxnDate] = useState(transaction.txnDate);
  const [fromAccountId, setFromAccountId] = useState(
    String(transaction.fromAccountId),
  );
  const [toAccountId, setToAccountId] = useState(
    String(transaction.toAccountId),
  );
  const [fromAmount, setFromAmount] = useState(transaction.fromAmount.amount);
  const [fromCurrency, setFromCurrency] = useState(
    transaction.fromAmount.currency,
  );
  const [toAmount, setToAmount] = useState(transaction.toAmount.amount);
  const [toCurrency, setToCurrency] = useState(transaction.toAmount.currency);
  // Stored scaled by 1e8 (§6) and edited as the decimal a person reads off a
  // statement; the edge does the scaling, never the browser.
  const [rate, setRate] = useState(
    transaction.rate === null ? '' : formatMinor(transaction.rate, 8),
  );
  const [notes, setNotes] = useState(transaction.notes ?? '');

  const options = accounts.data ?? [];
  const from = options.find((one) => one.id === Number(fromAccountId));
  const to = options.find((one) => one.id === Number(toAccountId));

  const sameAccount = fromAccountId !== '' && fromAccountId === toAccountId;
  // §7: a rate is meaningless when the currency does not change, and the
  // database refuses one — so the field goes rather than being refused later.
  const sameCurrency = fromCurrency === toCurrency;

  const errors = fieldErrors(edit.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (edit.isPending || sameAccount) return;

    edit.mutate(
      {
        transactionId: transaction.id,
        code: code.trim(),
        txnDate,
        fromAccountId: Number(fromAccountId),
        toAccountId: Number(toAccountId),
        fromAmount,
        fromCurrencyCode: fromCurrency,
        toAmount,
        toCurrencyCode: toCurrency,
        ...(sameCurrency || rate.trim() === '' ? { rate: null } : { rate }),
        notes: notes.trim() === '' ? null : notes.trim(),
      },
      {
        onSuccess: (result) => {
          onSaved(result.transaction);
        },
      },
    );
  };

  const failure =
    edit.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(edit.error);

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <DialogTitle id="edit-transaction-title">
        Edit {transaction.code}
      </DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          What this leg is now. It stays where it is in the tree, and the fees
          on it stay as they were recorded — change an amount or a rate and the
          data-quality checks will say the fees no longer match the schedule.
        </DialogContentText>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Reference code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            fullWidth
            size="small"
            required
            autoFocus
            disabled={edit.isPending}
            error={errors['code'] !== undefined}
            helperText={errors['code']}
          />

          <TextField
            label="Date"
            type="date"
            value={txnDate}
            onChange={(event) => {
              setTxnDate(event.target.value);
            }}
            fullWidth
            size="small"
            required
            disabled={edit.isPending}
            slotProps={{ inputLabel: { shrink: true } }}
            error={errors['txnDate'] !== undefined}
            helperText={errors['txnDate']}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            select
            label="From account"
            value={fromAccountId}
            onChange={(event) => {
              setFromAccountId(event.target.value);
            }}
            fullWidth
            size="small"
            required
            disabled={edit.isPending}
            error={errors['fromAccountId'] !== undefined}
            helperText={errors['fromAccountId']}
          >
            {options.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="To account"
            value={toAccountId}
            onChange={(event) => {
              setToAccountId(event.target.value);
            }}
            fullWidth
            size="small"
            required
            disabled={edit.isPending}
            error={sameAccount || errors['toAccountId'] !== undefined}
            helperText={
              sameAccount
                ? 'A leg moves money between two different accounts. Choose another.'
                : errors['toAccountId']
            }
          >
            {options.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <AmountField
            label="Amount sent"
            value={fromAmount}
            onChange={setFromAmount}
            required
            disabled={edit.isPending}
            {...(errors['fromAmount'] === undefined
              ? {}
              : { error: errors['fromAmount'] })}
          />
          <TextField
            select
            label="Currency sent"
            value={fromCurrency}
            onChange={(event) => {
              setFromCurrency(event.target.value);
            }}
            fullWidth
            size="small"
            required
            disabled={edit.isPending}
            error={errors['fromCurrencyCode'] !== undefined}
            helperText={errors['fromCurrencyCode']}
          >
            {currencyOptions(from, transaction.fromAmount.currency).map(
              (currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ),
            )}
          </TextField>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <AmountField
            label="Amount received"
            value={toAmount}
            onChange={setToAmount}
            required
            disabled={edit.isPending}
            {...(errors['toAmount'] === undefined
              ? {}
              : { error: errors['toAmount'] })}
          />
          <TextField
            select
            label="Currency received"
            value={toCurrency}
            onChange={(event) => {
              setToCurrency(event.target.value);
            }}
            fullWidth
            size="small"
            required
            disabled={edit.isPending}
            error={errors['toCurrencyCode'] !== undefined}
            helperText={errors['toCurrencyCode']}
          >
            {currencyOptions(to, transaction.toAmount.currency).map(
              (currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ),
            )}
          </TextField>
        </Box>

        {sameCurrency ? null : (
          <Box sx={{ mt: 2 }}>
            <AmountField
              label="Rate"
              value={rate}
              onChange={setRate}
              decimals={8}
              suffix={`${toCurrency} per ${fromCurrency}`}
              disabled={edit.isPending}
              helperText="Eight decimals are kept. Leave blank if it is not known yet — the checks will flag it."
              {...(errors['rate'] === undefined
                ? {}
                : { error: errors['rate'] })}
            />
          </Box>
        )}

        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
          fullWidth
          size="small"
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          disabled={edit.isPending}
          error={errors['notes'] !== undefined}
          helperText={errors['notes']}
        />

        {failure === null ? null : (
          <Box sx={{ mt: 2 }}>
            <ErrorState
              message={failure.message}
              {...(failure.action === undefined
                ? {}
                : { detail: failure.action })}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={edit.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={edit.isPending || sameAccount}
        >
          {edit.isPending ? 'Saving…' : 'Save leg'}
        </Button>
      </DialogActions>
    </Box>
  );
}
