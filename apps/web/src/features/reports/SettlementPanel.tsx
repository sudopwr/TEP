import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import { useSettlement, type FeeType } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { ErrorState, MoneyDisplay, StatCard } from '../../shared/components';

/**
 * F9 — gross proceeds, fees by type, net credited.
 *
 * Three cards and a breakdown, in the order the money moves: what the sales
 * produced, what was taken out of it, what arrived. Reading left to right is
 * reading the arithmetic, and the fee list underneath answers the only
 * question the three cards raise — which of these took ₹1,384.63.
 *
 * Every figure is the server's. The browser does not add the fees up and does
 * not subtract them from the gross: §13 makes totals derived server-side, and
 * a second implementation here would be a second answer to the one question
 * this application exists to answer correctly.
 *
 * The status is derived too, and never stored. `Payout.status()` returns
 * `settled` exactly when a sale leg has reached a bank account — so the chip
 * is a fact about the tree, not a flag somebody set.
 */

const FEE_LABELS: Readonly<Record<string, string>> = {
  tds: 'TDS',
  exchange_fee: 'Exchange fee',
  gst: 'GST',
  network_fee: 'Network fee',
  platform_charge: 'Platform charge',
};

/** The order a statement lists them in — statutory first, then the exchange. */
const FEE_ORDER: readonly FeeType[] = [
  'tds',
  'exchange_fee',
  'gst',
  'network_fee',
  'platform_charge',
];

export function SettlementPanel({ payoutId }: { readonly payoutId: number }) {
  const settlement = useSettlement(payoutId);

  if (settlement.isError) {
    const failure = describeError(settlement.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void settlement.refetch();
        }}
      />
    );
  }

  if (settlement.isPending) {
    return <Skeleton variant="rectangular" height={104} />;
  }

  const data = settlement.data;
  const fees = FEE_ORDER.map((feeType) => ({
    feeType,
    amount: data.feesByType[feeType],
  })).filter((entry) => entry.amount !== undefined);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Typography variant="h2">Settlement</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={data.status === 'settled' ? 'Settled' : 'Open'}
          sx={{
            color: data.status === 'settled' ? 'positive.main' : 'flag.main',
            borderColor: 'divider',
          }}
        />
        <Typography variant="body2" sx={{ color: 'muted.main' }}>
          {data.status === 'settled'
            ? 'A sale has reached a bank account.'
            : 'No sale has reached a bank account yet.'}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <StatCard
          testId="settlement-gross"
          label="Gross proceeds"
          value={
            <MoneyDisplay
              minor={data.grossProceeds.minor}
              currency={data.grossProceeds.currency}
              showCurrency
            />
          }
          hint="What the sales produced, before anything was taken."
        />

        <StatCard
          testId="settlement-fees"
          label="Total fees"
          value={
            <MoneyDisplay
              minor={data.totalFees.minor}
              currency={data.totalFees.currency}
              tone="negative"
              showCurrency
            />
          }
          hint="TDS, exchange fee and GST, in the settlement currency."
        />

        <StatCard
          testId="settlement-net"
          label="Net credited"
          value={
            <MoneyDisplay
              minor={data.netCredited.minor}
              currency={data.netCredited.currency}
              tone="positive"
              showCurrency
              bold
            />
          }
          hint="What reached the bank."
        />
      </Box>

      {fees.length === 0 ? null : (
        <Box sx={{ mt: 2, maxWidth: 360 }}>
          <Typography variant="label" component="h3" sx={{ display: 'block' }}>
            Where the fees went
          </Typography>

          {fees.map((entry) => (
            <Box
              key={entry.feeType}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                py: 0.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2">
                {FEE_LABELS[entry.feeType] ?? entry.feeType}
              </Typography>
              <MoneyDisplay
                // `fees` was filtered on exactly this, but
                // `noUncheckedIndexedAccess` cannot see through a `.filter`.
                minor={entry.amount?.minor ?? '0'}
                currency={entry.amount?.currency ?? data.currency}
                tone="negative"
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
