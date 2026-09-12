import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import { useCompanies, usePayouts } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { CurrencyChip, ErrorState } from '../../shared/components';

/**
 * Who awarded it, when, and under what reference.
 *
 * The figures are deliberately *not* here — they belong to the settlement,
 * which is the server's arithmetic, and repeating the gross next to it would
 * invite the reader to compare two numbers that came from the same place.
 * This says which payout you are looking at; the panels below say what
 * happened to it.
 *
 * There is no `GET /api/payouts/:id`, so this reads the list and picks the
 * one it wants. On a few dozen payouts that is a cheaper request than the
 * round trip to add the endpoint, and the list is already cached by the
 * screen that linked here.
 */
export function PayoutHeader({ payoutId }: { readonly payoutId: number }) {
  const payouts = usePayouts();
  const companies = useCompanies();

  if (payouts.isError) {
    const failure = describeError(payouts.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void payouts.refetch();
        }}
      />
    );
  }

  if (payouts.isPending) {
    return <Skeleton variant="text" width={320} height={40} />;
  }

  const payout = payouts.data.find((one) => one.id === payoutId);

  if (payout === undefined) {
    return (
      <ErrorState
        title="No such payout"
        message={`There is no payout numbered ${String(payoutId)}.`}
        detail="It may have been recorded on a different database, or the link may be from an older import."
      />
    );
  }

  const company = companies.data?.find((one) => one.id === payout.companyId);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography variant="h1">{payout.code}</Typography>
        <CurrencyChip code={payout.gross.currency} />
      </Box>

      <Typography sx={{ color: 'muted.main', mt: 0.5 }}>
        {company?.name ?? `Company ${String(payout.companyId)}`} ·{' '}
        {payout.payoutDate}
      </Typography>

      {payout.reference === null ? null : (
        <Typography
          variant="numeric"
          component="p"
          sx={{ color: 'muted.main', mt: 0.5 }}
        >
          {/*
            Rendered as text, always. §9 defect 3: Excel turned a reference of
            this kind into `1.43908E+19` and destroyed it. The column is TEXT
            all the way down, and so is this.
          */}
          Reference {payout.reference}
        </Typography>
      )}

      {payout.notes === null ? null : (
        <Typography variant="body2" sx={{ mt: 1, maxWidth: 620 }}>
          {payout.notes}
        </Typography>
      )}
    </Box>
  );
}
