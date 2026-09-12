import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { useDataQuality, type DataQualityIssueJson } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  DataTable,
  ErrorState,
  StatCard,
  type Column,
} from '../../shared/components';

/**
 * F11 — the rows worth a second look.
 *
 * The whole screen turns on one distinction, and the copy has to carry it:
 * these are **suspicious, not wrong**. §7 puts impossible states in database
 * constraints, where they cannot be entered at all, and puts these in a view
 * — because every one of them has a legitimate explanation. A leg that sends
 * more than its parent delivered is exactly what happens when earlier dust
 * was still sitting in the wallet, and §10 says 1.3323 USDT was.
 *
 * So: ochre, never red. Red is the colour of the negative token, which this
 * application uses for money that left — a fact. A flag is a question, and
 * colouring a question like a fact is how a person learns to ignore both.
 */

const CHECK_LABELS: Readonly<Record<string, string>> = {
  fee_off_schedule: 'Fee off schedule',
  unreconciled_rate: 'Rate missing',
  amount_unreconciled: 'Amount does not reconcile',
  exceeds_parent: 'Sends more than it received',
  currency_not_allowed: 'Currency not allowed here',
};

export function DataQualityScreen() {
  const checks = useDataQuality();

  const columns: readonly Column<DataQualityIssueJson>[] = useMemo(
    () => [
      {
        id: 'subject',
        header: 'Row',
        cell: (issue) => (
          <Typography variant="numeric">{issue.subject}</Typography>
        ),
        sortBy: (issue) => issue.subject,
      },
      {
        id: 'check',
        header: 'Flag',
        cell: (issue) => (
          <Typography sx={{ color: 'flag.main', fontWeight: 600 }}>
            {CHECK_LABELS[issue.check] ?? issue.check}
          </Typography>
        ),
        sortBy: (issue) => issue.check,
      },
      {
        id: 'detail',
        header: 'What the check saw',
        cell: (issue) => (
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {issue.detail}
          </Typography>
        ),
        sortBy: (issue) => issue.detail,
      },
    ],
    [],
  );

  if (checks.isError) {
    const failure = describeError(checks.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void checks.refetch();
        }}
      />
    );
  }

  const issues = checks.data ?? [];

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Data quality
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3, maxWidth: 640 }}>
        Rows that look unusual. Every one of these has a legitimate explanation
        — a flat fee that moved, a partial fill, dust left over from an earlier
        transfer. They are worth reading, not fixing on sight.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <StatCard
          label="Flagged rows"
          value={
            <Typography
              variant="numeric"
              sx={{ fontSize: 17, fontWeight: 600 }}
            >
              {String(issues.length)}
            </Typography>
          }
          hint={
            issues.length === 0
              ? 'Nothing stands out.'
              : 'Each one is a question, not a defect.'
          }
        />
      </Box>

      <DataTable<DataQualityIssueJson>
        rows={issues}
        columns={columns}
        // Two checks can flag the same row for different reasons — a sale
        // whose exchange fee and GST are both off schedule appears twice —
        // so the subject alone is not a key.
        rowKey={(issue) => `${issue.subject}:${issue.check}:${issue.detail}`}
        loading={checks.isPending}
        caption="Flagged rows"
        empty={{
          message: 'Nothing is flagged.',
          hint: 'Every recorded fee is within tolerance of its schedule, every cross-currency move has a rate, and no leg sends more than it received.',
        }}
      />
    </Box>
  );
}
