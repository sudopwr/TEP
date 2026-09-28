import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';

import {
  useChainLookup,
  type AccountJson,
  type ChainTransferJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';

/**
 * F28 — the three fields a leg has when it moved along a chain.
 *
 * **When they are shown.** A hop is on a chain if either account is a wallet
 * or either side is a token. Both halves are needed: a wallet can be topped
 * up in USD on a platform that never shows an address, and an exchange with
 * no wallet in sight still sends USDT out of one. The rule is the interface's
 * — the columns are plain and optional, so nothing is refused for being
 * unusual (§7 flags rather than forbids).
 *
 * **Why a token is spotted by its scale.** The currencies table marks crypto
 * by `kind`, which the browser never sees; what it does know is §6's scales,
 * and no fiat here is stored past three decimals while a token is stored to
 * eight. `MoneyDisplay`'s table is the same knowledge, hard-coded for the
 * same reason: there is no endpoint that lists currencies.
 */

/** Codes this application stores to more than three decimals, i.e. tokens. */
const TOKENS: ReadonlySet<string> = new Set(['USDT', 'USDC', 'BTC', 'ETH']);

export function isToken(currency: string): boolean {
  return TOKENS.has(currency.trim().toUpperCase());
}

export function movesOnChain(input: {
  readonly from?: AccountJson | undefined;
  readonly to?: AccountJson | undefined;
  readonly fromCurrency?: string;
  readonly toCurrency?: string;
}): boolean {
  return (
    input.from?.type === 'wallet' ||
    input.to?.type === 'wallet' ||
    isToken(input.fromCurrency ?? '') ||
    isToken(input.toCurrency ?? '')
  );
}

export interface ChainValues {
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly explorerUrl: string;
}

export const EMPTY_CHAIN: ChainValues = {
  fromAddress: '',
  toAddress: '',
  explorerUrl: '',
};

/** What the command carries: trimmed, and absent rather than empty. */
export function toChainCommand(values: ChainValues): {
  fromAddress?: string;
  toAddress?: string;
  explorerUrl?: string;
} {
  return {
    ...(values.fromAddress.trim() === ''
      ? {}
      : { fromAddress: values.fromAddress.trim() }),
    ...(values.toAddress.trim() === ''
      ? {}
      : { toAddress: values.toAddress.trim() }),
    ...(values.explorerUrl.trim() === ''
      ? {}
      : { explorerUrl: values.explorerUrl.trim() }),
  };
}

/** How long to wait after the last keystroke before asking (F29). */
const LOOKUP_DELAY_MS = 600;

/**
 * The three inputs, on both the record form and the edit dialog.
 *
 * One component rather than two copies: they are the same three fields with
 * the same help, and a wallet address that is validated on one screen and not
 * the other is the kind of difference nobody notices until it is wrong.
 *
 * **The link fills the other two** (F29). A wallet address typed by hand is
 * how a ledger ends up with one that is *almost* right — which is worse than
 * none, because it looks checkable. The link is already in the clipboard of
 * anybody who has just made the transfer, and the chain knows both ends.
 * What comes back is filled in and left editable.
 *
 * **A bare hash does as well**, which is what an exchange usually gives you.
 * The chain it belongs to is worked out by asking, and the field then takes
 * back the canonical page — so a hash typed in becomes a link anybody can
 * follow a year later.
 */
export function ChainFieldset({
  values,
  onChange,
  onFound,
  errors = {},
  disabled = false,
}: {
  readonly values: ChainValues;
  readonly onChange: (values: ChainValues) => void;
  /**
   * The whole transfer, for the form around this one (F30).
   *
   * The amount belongs to the leg, not to these three fields, so it is
   * handed up rather than filled here — this component owns the chain and
   * the form owns the money.
   */
  readonly onFound?: (transfer: ChainTransferJson) => void;
  readonly errors?: Readonly<Record<string, string | undefined>>;
  readonly disabled?: boolean;
}) {
  const lookup = useChainLookup();

  const set = (part: Partial<ChainValues>): void => {
    onChange({ ...values, ...part });
  };

  /*
    What this component filled in last, so it can tell its own work from the
    reader's.

    An address they typed is never overwritten — that is the difference
    between a helpful form and one that fights you. An address *this* put
    there is replaced freely, so correcting the link corrects the addresses
    instead of leaving the first answer sitting in the field.
  */
  const filled = useRef<{ from: string; to: string }>({ from: '', to: '' });
  const asked = useRef('');
  const latest = useRef(values);
  latest.current = values;

  const apply = (found: ChainTransferJson) => {
    const current = latest.current;
    const mine = filled.current;
    const next = { ...current };

    if (current.fromAddress === '' || current.fromAddress === mine.from) {
      next.fromAddress = found.fromAddress;
    }
    if (
      found.toAddress !== null &&
      (current.toAddress === '' || current.toAddress === mine.to)
    ) {
      next.toAddress = found.toAddress;
    }

    /*
      The field takes back the canonical page, which is what a bare hash is
      worth once the chain is known.

      It also has to happen: this column is rendered as an anchor and the
      edge takes only http(s), so a hash left in the field would be refused
      on save. `asked` is moved with it, or the effect would look the link
      up again the moment it changed.
    */
    if (
      typeof found.explorerUrl === 'string' &&
      found.explorerUrl !== '' &&
      found.explorerUrl !== current.explorerUrl
    ) {
      next.explorerUrl = found.explorerUrl;
      asked.current = found.explorerUrl;
    }

    filled.current = { from: next.fromAddress, to: next.toAddress };
    onChange(next);
    onFound?.(found);
  };

  /*
    Asked once the typing stops, not on every keystroke.

    A paste arrives as one change and fires after the same pause, which is
    the case that matters: the link is pasted, and a moment later the two
    addresses are there. `asked` keeps a link from being looked up twice
    while the component re-renders around the answer.
  */
  useEffect(() => {
    const link = values.explorerUrl.trim();

    if (disabled || link === '' || link === asked.current) return undefined;

    const timer = setTimeout(() => {
      asked.current = link;
      lookup.mutate(link, { onSuccess: apply });
    }, LOOKUP_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
    /*
      The link and the disabled flag, and nothing else, on purpose.

      `lookup` and `apply` are new objects on every render, so listing them
      would re-run this effect against its own answer — asking the explorer
      again for what is already on screen. The rule that would insist on
      them is not installed here; this comment is the argument it would
      have wanted.
    */
  }, [values.explorerUrl, disabled]);

  const askNow = (): void => {
    const link = values.explorerUrl.trim();
    if (link === '') return;

    asked.current = link;
    lookup.mutate(link, { onSuccess: apply });
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        variant="label"
        component="h3"
        sx={{ display: 'block', mb: 1, color: 'muted.main' }}
      >
        On the chain
      </Typography>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="From wallet address"
          value={values.fromAddress}
          onChange={(event) => {
            set({ fromAddress: event.target.value });
          }}
          fullWidth
          size="small"
          disabled={disabled}
          error={errors['fromAddress'] !== undefined}
          helperText={errors['fromAddress'] ?? 'The address it left from.'}
          slotProps={{ htmlInput: { spellCheck: false } }}
        />

        <TextField
          label="To wallet address"
          value={values.toAddress}
          onChange={(event) => {
            set({ toAddress: event.target.value });
          }}
          fullWidth
          size="small"
          disabled={disabled}
          error={errors['toAddress'] !== undefined}
          helperText={errors['toAddress'] ?? 'The address it arrived at.'}
          slotProps={{ htmlInput: { spellCheck: false } }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 2, alignItems: 'flex-start' }}>
        <TextField
          label="Transaction link or hash"
          value={values.explorerUrl}
          onChange={(event) => {
            set({ explorerUrl: event.target.value });
          }}
          fullWidth
          size="small"
          disabled={disabled}
          error={errors['explorerUrl'] !== undefined}
          helperText={
            errors['explorerUrl'] ??
            'Paste the link or just the hash — the addresses above fill themselves.'
          }
          slotProps={{ htmlInput: { spellCheck: false } }}
        />

        {/*
          A button as well as the automatic look-up, for the two cases the
          pause cannot cover: a lookup that failed and is worth retrying, and
          a link that was already in the field when the form opened.
        */}
        <Button
          color="inherit"
          size="small"
          sx={{ mt: 0.5, flexShrink: 0 }}
          disabled={disabled || lookup.isPending || values.explorerUrl.trim() === ''}
          onClick={askNow}
        >
          {lookup.isPending ? 'Reading…' : 'Look up'}
        </Button>
      </Box>

      <LookupStatus lookup={lookup} />
    </Box>
  );
}

/**
 * What the chain said, in a line.
 *
 * The failures are the interesting half, and the server writes them for the
 * reader (§12): a link to somewhere unsupported, a hash nobody has seen, and
 * "could not read it just now" are three different things to do next, and
 * the third one ends with "the addresses can be typed in" because they can.
 */
function LookupStatus({
  lookup,
}: {
  readonly lookup: ReturnType<typeof useChainLookup>;
}) {
  if (lookup.isPending) {
    return (
      <Typography variant="body2" sx={{ color: 'muted.main', mt: 0.5 }}>
        Reading the chain…
      </Typography>
    );
  }

  if (lookup.error !== null) {
    return (
      <Typography
        role="status"
        variant="body2"
        sx={{ color: 'negative.main', mt: 0.5 }}
      >
        {describeError(lookup.error).message}
      </Typography>
    );
  }

  if (lookup.data !== undefined) {
    return (
      <Typography role="status" variant="body2" sx={{ color: 'muted.main', mt: 0.5 }}>
        {lookup.data.amount === null
          ? `Filled in from ${lookup.data.chain}.`
          : `Filled in from ${lookup.data.chain}: ${lookup.data.amount} ${lookup.data.tokenSymbol ?? ''}`.trim()}{' '}
        Check it against your wallet — a transfer through a contract can name
        the contract, not the person.
      </Typography>
    );
  }

  return null;
}

/**
 * An address as it reads in a table: the ends, in the numeric face.
 *
 * Middle-truncated rather than clipped, because the two ends are what a
 * reader compares against a wallet app; the middle of a 42-character hash is
 * the part nobody checks. The whole thing is in the title, so it can still be
 * read and copied.
 */
export function ShortAddress({ value }: { readonly value: string }) {
  const short =
    value.length <= 20 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;

  return (
    <Typography
      component="span"
      variant="numeric"
      title={value}
      sx={{ color: 'muted.main', fontSize: '0.8125rem' }}
    >
      {short}
    </Typography>
  );
}

/**
 * The explorer link, or nothing.
 *
 * The scheme is checked here as well as at the edge: the server refuses
 * anything but http and https, and this refuses to render what it is given if
 * it somehow is not — a `javascript:` href in a ledger would be a script the
 * reader runs by clicking their own evidence. `noreferrer` keeps the payout
 * address out of the explorer's logs.
 */
export function ExplorerLink({ url }: { readonly url: string }) {
  if (!isWebUrl(url)) return null;

  return (
    <Link
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      variant="body2"
      sx={{ fontSize: '0.8125rem' }}
    >
      View on explorer
    </Link>
  );
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);

    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
