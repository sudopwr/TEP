import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  SOURCE_CURRENCY_FEE_TYPES,
  impliedCharge,
  type SourceCurrencyFeeType,
} from '@payout/core';
import { useRef, useState, type FormEvent } from 'react';

import { Link as RouterLink } from 'react-router-dom';

import {
  useAccounts,
  useRecordTransaction,
  useSettlePayout,
  useTransactions,
  type AccountJson,
  type ChainTransferJson,
  type CreateMovementCommand,
  type CreateSaleCommand,
} from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { AmountField, ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import {
  ChainFieldset,
  EMPTY_CHAIN,
  movesOnChain,
  toChainCommand,
  type ChainValues,
} from './chain';

/**
 * F3/F4 — record one leg of the tree.
 *
 * Two shapes behind one form, discriminated on the kind, exactly as the API's
 * schema is (`movementBody` and `saleBody`). A sale is not a transfer with
 * extra fields: it has no destination amount, because gross proceeds are the
 * from-amount times the rate and the server computes them (§13); it must have
 * a rate; and it carries TDS from the statement. Letting the reader type a
 * destination amount on a sale would be inviting them to disagree with the
 * exchange.
 *
 * The rate field disappears when both sides are the same currency, because
 * §7 makes that an impossible state rather than a suspicious one:
 * `rate_applied IS NULL when from_currency = to_currency` is a database
 * constraint, and offering a box the database will reject is a form that
 * wastes a round trip to say no.
 */

export interface RecordTransactionFormProps {
  readonly payoutId: number;
  readonly onRecorded: () => void;
  readonly onCancel: () => void;
}

const MOVEMENT_KINDS = [
  { value: 'payout_credit', label: 'Credit — the award lands' },
  { value: 'withdrawal', label: 'Withdrawal — off the platform' },
  { value: 'transfer', label: 'Transfer — between wallets' },
  { value: 'deposit', label: 'Deposit — onto an exchange' },
] as const;

const KIND_OPTIONS = [
  ...MOVEMENT_KINDS,
  { value: 'sale', label: 'Sale — the leg that produces rupees' },
] as const;

type Kind = (typeof KIND_OPTIONS)[number]['value'];

/**
 * What a charge may be filed as (F32), keyed by the domain's own list.
 *
 * A `Record`, so adding a third source-currency fee type in the domain fails
 * to compile here rather than quietly dropping out of the dropdown.
 */
const CHARGE_LABELS: Record<SourceCurrencyFeeType, string> = {
  network_fee: 'Network fee',
  platform_charge: 'Platform charge',
};

/**
 * What the charge on this kind of leg usually is.
 *
 * The award arrives light because the firm charged for paying it (§10's
 * $100.79); everything after that is a processor or a chain taking its cut.
 */
function chargeTypeFor(kind: Kind): SourceCurrencyFeeType {
  return kind === 'payout_credit' ? 'platform_charge' : 'network_fee';
}

/** Today, as `YYYY-MM-DD` in local time, for the date field's default. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${String(now.getFullYear())}-${month}-${day}`;
}

function currenciesOf(account: AccountJson | undefined): readonly string[] {
  return account?.allowedCurrencies ?? [];
}

export function RecordTransactionForm({
  payoutId,
  onRecorded,
  onCancel,
}: RecordTransactionFormProps) {
  const accounts = useAccounts();
  const existing = useTransactions(payoutId);
  const recordMovement = useRecordTransaction();
  const recordSale = useSettlePayout();
  const { notify } = useToast();

  const [kind, setKind] = useState<Kind>('withdrawal');
  const [code, setCode] = useState('');
  const [txnDate, setTxnDate] = useState(today);
  const [parentId, setParentId] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [fromAmount, setFromAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [toCurrency, setToCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [tds, setTds] = useState('');
  const [chain, setChain] = useState<ChainValues>(EMPTY_CHAIN);
  const [notes, setNotes] = useState('');
  /*
    The charge, and whether anybody has touched it (F32).

    Untouched, the field *shows* the difference between the two amounts rather
    than holding a copy of it: derived, so it follows both amounts as they are
    typed, with no effect to keep in step and nothing stale to clear. The first
    keystroke in it — or in the type beside it — makes it the reader's, and
    from then on their figure stands even when the amounts change under it.
    Emptying it is an answer too, and means no charge.
  */
  const [charge, setCharge] = useState('');
  const [chargeTouched, setChargeTouched] = useState(false);
  const [chargeType, setChargeType] =
    useState<SourceCurrencyFeeType>('network_fee');
  const [chargeTypeTouched, setChargeTypeTouched] = useState(false);

  /*
    `useAccounts`, not `useAccountBalances`. Balances are derived from
    movements (UC7), so an account recorded a minute ago is absent from them —
    and the commonest reason to be on this screen with a missing account is
    that you have just created it.
  */
  const options = accounts.data ?? [];

  const from = options.find((one) => String(one.id) === fromAccountId);
  const to = options.find((one) => String(one.id) === toAccountId);

  /*
    §7's first invariant — `from_account_id <> to_account_id` — caught before
    the request rather than after it.

    The server refuses this too (`SameAccountTransferError`), and that refusal
    is what actually guarantees it; this is the same arrangement as the
    password policy, where the browser runs the check for the reader's sake
    and the server runs it for the database's. What it buys is a message under
    the field that is wrong, instead of a round trip ending in a banner above
    a form the reader then has to re-read.
  */
  const sameAccount = fromAccountId !== '' && fromAccountId === toAccountId;

  const isSale = kind === 'sale';
  /** F28 — a wallet on either side, or a token on either side. */
  const onChain = movesOnChain({
    from,
    to,
    fromCurrency,
    toCurrency,
  });
  const mutation = isSale ? recordSale : recordMovement;
  const sameCurrency =
    !isSale && fromCurrency !== '' && fromCurrency === toCurrency;
  const errors = fieldErrors(mutation.error);

  /*
    F32 — what the leg kept.

    Only on a movement: a sale's fees come off §8's schedule and its TDS off
    the statement, so a box inviting a third figure there would be inviting a
    disagreement with the exchange.

    Across two currencies the rate goes with it, because the gap between the
    amounts is then mostly the rate and the fee is what is left after taking
    the arrival back through it — §10's withdrawals are USD out and USDT in at
    1.00000000, and that is where the flat $4.03 hides. With no rate typed yet
    there is nothing to divide by, and `impliedCharge` says so by answering
    nothing rather than subtracting two different currencies.
  */
  const suggestedCharge = isSale
    ? null
    : impliedCharge(fromAmount, toAmount, sameCurrency ? null : rate);
  const chargeValue = chargeTouched ? charge : (suggestedCharge ?? '');
  const chargeTypeValue = chargeTypeTouched ? chargeType : chargeTypeFor(kind);


  /*
    What the chain said the amount was (F30).

    Filled under the same rule as the addresses — only into a field that is
    empty or that this filled before — and only when the token is the
    currency being recorded. A USDT figure dropped into a leg somebody is
    recording in rupees would be a number that looks right and is not, which
    is the one failure this whole feature exists to avoid.
  */
  const filledAmounts = useRef<{ from: string; to: string }>({
    from: '',
    to: '',
  });

  const fillFromChain = (found: ChainTransferJson): void => {
    if (found.amount === null || found.tokenSymbol === null) return;

    const token = found.tokenSymbol.toUpperCase();
    const matches = (currency: string): boolean =>
      currency === '' || currency.toUpperCase() === token;

    if (
      matches(fromCurrency) &&
      (fromAmount === '' || fromAmount === filledAmounts.current.from)
    ) {
      setFromAmount(found.amount);
      filledAmounts.current = { ...filledAmounts.current, from: found.amount };
    }

    // Each side judged on its own currency: on an INR-to-USDT leg only the
    // received side is the token, and a sale has no received field at all
    // — its proceeds are rupees the chain knows nothing about.
    if (
      !isSale &&
      matches(toCurrency) &&
      (toAmount === '' || toAmount === filledAmounts.current.to)
    ) {
      setToAmount(found.amount);
      filledAmounts.current = { ...filledAmounts.current, to: found.amount };
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (mutation.isPending || sameAccount) return;

    const shared = {
      code: code.trim(),
      payoutId,
      txnDate,
      fromAccountId: Number(fromAccountId),
      toAccountId: Number(toAccountId),
      fromAmount,
      fromCurrencyCode: fromCurrency,
      ...(parentId === '' ? {} : { parentId: Number(parentId) }),
      // Sent only when the fields are on screen: a wallet address left over
      // from a kind the reader changed their mind about would be recorded
      // against a leg that never went near a chain (F28).
      ...(onChain ? toChainCommand(chain) : {}),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    };

    if (isSale) {
      const command: CreateSaleCommand = {
        ...shared,
        kind: 'sale',
        rate,
        settlementCurrencyCode: toCurrency,
        ...(tds.trim() === '' ? {} : { tds }),
      };

      recordSale.mutate(command, {
        onSuccess: () => {
          notify('Sale recorded');
          onRecorded();
        },
      });
      return;
    }

    const command: CreateMovementCommand = {
      ...shared,
      kind,
      toAmount,
      toCurrencyCode: toCurrency,
      // Null rather than omitted when the currencies match: §7's constraint
      // is about the stored column, and being explicit here says the absence
      // was a decision rather than a forgotten field.
      ...(sameCurrency || rate.trim() === '' ? { rate: null } : { rate }),
      // Omitted when the field is empty, which is a leg that cost nothing
      // rather than one charged zero (F32).
      ...(chargeValue.trim() === ''
        ? {}
        : { charge: { feeType: chargeTypeValue, amount: chargeValue.trim() } }),
    };

    recordMovement.mutate(command, {
      onSuccess: () => {
        notify('Transaction recorded');
        onRecorded();
      },
    });
  };

  const failure =
    mutation.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(mutation.error);

  return (
    <Paper sx={{ p: 3, maxWidth: 640 }}>
      <Box component="form" onSubmit={submit} noValidate>
        <TextField
          select
          label="What happened"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as Kind);
          }}
          fullWidth
          size="small"
        >
          {KIND_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label="Reference code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            fullWidth
            size="small"
            required
            helperText={errors['code'] ?? 'The identifier on the statement.'}
            error={errors['code'] !== undefined}
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
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={errors['txnDate']}
            error={errors['txnDate'] !== undefined}
          />
        </Box>

        <TextField
          select
          label="Follows on from"
          value={parentId}
          onChange={(event) => {
            setParentId(event.target.value);
          }}
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          helperText="The leg this one continues. Leave blank for the first leg of the payout."
        >
          <MenuItem value="">Nothing — this starts the tree</MenuItem>
          {(existing.data ?? []).map((transaction) => (
            <MenuItem key={transaction.id} value={String(transaction.id)}>
              {transaction.code} · {transaction.kind}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            select
            label="From account"
            value={fromAccountId}
            onChange={(event) => {
              setFromAccountId(event.target.value);
              setFromCurrency('');
            }}
            fullWidth
            size="small"
            required
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
              setToCurrency('');
            }}
            fullWidth
            size="small"
            required
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

        {options.length === 0 && !accounts.isPending ? (
          <Typography variant="body2" sx={{ color: 'flag.main', mt: 1 }}>
            There are no accounts yet, so there is nothing to move money
            between.{' '}
            <RouterLink to="/accounts/new">Record one first.</RouterLink>
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <AmountField
            label="Amount sent"
            value={fromAmount}
            onChange={setFromAmount}
            required
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
            error={errors['fromCurrencyCode'] !== undefined}
            helperText={errors['fromCurrencyCode']}
          >
            {currenciesOf(from).map((currency) => (
              <MenuItem key={currency} value={currency}>
                {currency}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          {isSale ? (
            <TextField
              label="Proceeds"
              value="Worked out from the rate"
              fullWidth
              size="small"
              disabled
              helperText="The server applies the exchange's schedule and reports the net."
            />
          ) : (
            <AmountField
              label="Amount received"
              value={toAmount}
              onChange={setToAmount}
              required
              {...(errors['toAmount'] === undefined
                ? {}
                : { error: errors['toAmount'] })}
            />
          )}

          <TextField
            select
            label={isSale ? 'Settled in' : 'Currency received'}
            value={toCurrency}
            onChange={(event) => {
              setToCurrency(event.target.value);
            }}
            fullWidth
            size="small"
            required
            error={errors['toCurrencyCode'] !== undefined}
            helperText={errors['toCurrencyCode']}
          >
            {currenciesOf(to).map((currency) => (
              <MenuItem key={currency} value={currency}>
                {currency}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {sameCurrency ? (
          <Typography variant="body2" sx={{ color: 'muted.main', mt: 2 }}>
            Both sides are {fromCurrency}, so there is no rate to record.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <AmountField
              label="Rate"
              value={rate}
              onChange={setRate}
              decimals={8}
              required={isSale}
              {...(toCurrency !== '' && fromCurrency !== ''
                ? { suffix: `${toCurrency} per ${fromCurrency}` }
                : {})}
              {...(errors['rate'] === undefined
                ? {}
                : { error: errors['rate'] })}
              helperText="Up to eight decimal places, as recorded by the exchange."
            />

            {isSale ? (
              <AmountField
                label="TDS withheld"
                value={tds}
                onChange={setTds}
                decimals={2}
                {...(toCurrency === '' ? {} : { currency: toCurrency })}
                helperText="From the statement. Never computed."
                {...(errors['tds'] === undefined
                  ? {}
                  : { error: errors['tds'] })}
              />
            ) : (
              <Box sx={{ width: '100%' }} />
            )}
          </Box>
        )}

        {/*
          F32 — the charge, filled in from the two amounts and editable.

          Beside the type it will be filed as, because a `transaction_fees`
          row needs one and "charges" is not a type: the difference on a
          credit is what the firm charged for paying, and on everything after
          it what a processor or a chain took.
        */}
        {isSale ? null : (
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <AmountField
              label="Charges"
              value={chargeValue}
              onChange={(value) => {
                setChargeTouched(true);
                setCharge(value);
              }}
              {...(fromCurrency === '' ? {} : { currency: fromCurrency })}
              helperText={
                suggestedCharge !== null
                  ? 'What the leg kept, worked out from the two amounts. Change it if the fee was something else.'
                  : sameCurrency
                    ? 'Nothing was kept, so there is nothing to record.'
                    : 'Record the rate and this fills itself, or type what the leg cost.'
              }
              {...(errors['charge.amount'] === undefined
                ? {}
                : { error: errors['charge.amount'] })}
            />

            <TextField
              select
              label="Charged as"
              value={chargeTypeValue}
              onChange={(event) => {
                setChargeTypeTouched(true);
                setChargeType(event.target.value as SourceCurrencyFeeType);
              }}
              fullWidth
              size="small"
              helperText={`Recorded in ${fromCurrency === '' ? 'the currency sent' : fromCurrency}, which is where it was taken from.`}
              error={errors['charge.feeType'] !== undefined}
            >
              {SOURCE_CURRENCY_FEE_TYPES.map((feeType) => (
                <MenuItem key={feeType} value={feeType}>
                  {CHARGE_LABELS[feeType]}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        )}

        {/*
          Only for a hop that went along a chain (F28) — a wallet on either
          side, or a token on either side. Asking a bank transfer for a wallet
          address is asking for a blank.
        */}
        {onChain ? (
          <ChainFieldset
            values={chain}
            onChange={setChain}
            onFound={fillFromChain}
            errors={errors}
            disabled={mutation.isPending}
          />
        ) : null}

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
          disabled={mutation.isPending}
          error={errors['notes'] !== undefined}
          helperText={
            errors['notes'] ??
            'Anything the statement does not say: why this hop, what the fee was for, who to ask.'
          }
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

        <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={mutation.isPending || sameAccount}
          >
            {mutation.isPending
              ? 'Recording…'
              : isSale
                ? 'Record sale'
                : 'Record transaction'}
          </Button>
          <Button onClick={onCancel} color="inherit">
            Cancel
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
