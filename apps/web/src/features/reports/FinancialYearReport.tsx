import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import {
  useFinancialYearReport,
  type CompanyTotalsJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  DataTable,
  ErrorState,
  MoneyDisplay,
  StatCard,
  type Column,
} from '../../shared/components';

/**
 * F13 — total credited, total TDS, total fees, grouped by company.
 *
 * Indian financial years, 1 April to 31 March, because that is the year this
 * report is filed against. A calendar-year default would produce a number
 * that looks right and cannot be copied onto anything.
 *
 * The range is a pair of dates rather than a free-text year so that a part
 * year is expressible: somebody reconciling a quarter, or checking the month
 * a particular payout landed in, needs the same totals over a different span.
 */

/** The last several financial years, newest first. */
function financialYears(
  count = 6,
): readonly { label: string; from: string; to: string }[] {
  const now = new Date();
  // Before April, the current financial year began in the previous calendar
  // year — this is the one arithmetic in the file, and getting it wrong shows
  // up as an empty report every January.
  const startYear =
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  return Array.from({ length: count }, (_unused, index) => {
    const begins = startYear - index;

    return {
      label: `${String(begins)}–${String((begins + 1) % 100).padStart(2, '0')}`,
      from: `${String(begins)}-04-01`,
      to: `${String(begins + 1)}-03-31`,
    };
  });
}

export function FinancialYearReport() {
  const years = useMemo(() => financialYears(), []);
  const [range, setRange] = useState(() => {
    const first = years[0];
    return { from: first?.from ?? '', to: first?.to ?? '' };
  });

  const report = useFinancialYearReport(
    range.from === '' || range.to === '' ? null : range,
  );

  const columns: readonly Column<CompanyTotalsJson>[] = useMemo(
    () => [
      {
        id: 'company',
        header: 'Company',
        cell: (row) => row.company.name,
        sortBy: (row) => row.company.name,
      },
      {
        id: 'payouts',
        header: 'Payouts',
        align: 'right',
        cell: (row) => (
          <Typography variant="numeric">{String(row.payoutCount)}</Typography>
        ),
        sortBy: (row) => row.payoutCount,
      },
      {
        id: 'credited',
        header: 'Credited',
        align: 'right',
        cell: (row) => (
          <MoneyDisplay
            minor={row.credited.minor}
            currency={row.credited.currency}
          />
        ),
        sortBy: (row) => BigInt(row.credited.minor),
      },
      {
        id: 'tds',
        header: 'TDS',
        align: 'right',
        cell: (row) => (
          <MoneyDisplay
            minor={row.tds.minor}
            currency={row.tds.currency}
            tone="negative"
          />
        ),
        sortBy: (row) => BigInt(row.tds.minor),
      },
      {
        id: 'fees',
        header: 'Fees',
        align: 'right',
        cell: (row) => (
          <MoneyDisplay
            minor={row.fees.minor}
            currency={row.fees.currency}
            tone="negative"
          />
        ),
        sortBy: (row) => BigInt(row.fees.minor),
      },
    ],
    [],
  );

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Financial year
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        What was credited, what was withheld, and what it cost — by company.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-start' }}>
        <TextField
          select
          label="Year"
          size="small"
          sx={{ width: 160 }}
          value={`${range.from}:${range.to}`}
          onChange={(event) => {
            const [from = '', to = ''] = event.target.value.split(':');
            setRange({ from, to });
          }}
        >
          {years.map((year) => (
            <MenuItem key={year.from} value={`${year.from}:${year.to}`}>
              {year.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="From"
          type="date"
          size="small"
          value={range.from}
          onChange={(event) => {
            setRange((current) => ({ ...current, from: event.target.value }));
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={range.to}
          onChange={(event) => {
            setRange((current) => ({ ...current, to: event.target.value }));
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>

      {report.isError ? (
        (() => {
          const failure = describeError(report.error);

          return (
            <ErrorState
              message={failure.message}
              {...(failure.action === undefined
                ? {}
                : { detail: failure.action })}
              onRetry={() => {
                void report.refetch();
              }}
            />
          );
        })()
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
            <StatCard
              label="Total credited"
              value={
                report.data === undefined ? (
                  '—'
                ) : (
                  <MoneyDisplay
                    minor={report.data.totalCredited.minor}
                    currency={report.data.totalCredited.currency}
                    tone="positive"
                    showCurrency
                  />
                )
              }
            />
            <StatCard
              label="Total TDS"
              value={
                report.data === undefined ? (
                  '—'
                ) : (
                  <MoneyDisplay
                    minor={report.data.totalTds.minor}
                    currency={report.data.totalTds.currency}
                    tone="negative"
                    showCurrency
                  />
                )
              }
              hint="Statutory, from the statements — never computed."
            />
            <StatCard
              label="Total fees"
              value={
                report.data === undefined ? (
                  '—'
                ) : (
                  <MoneyDisplay
                    minor={report.data.totalFees.minor}
                    currency={report.data.totalFees.currency}
                    tone="negative"
                    showCurrency
                  />
                )
              }
            />
          </Box>

          <DataTable<CompanyTotalsJson>
            rows={report.data?.byCompany ?? []}
            columns={columns}
            rowKey={(row) => row.company.id}
            loading={report.isFetching && report.data === undefined}
            caption="Totals by company"
            empty={{
              message: 'Nothing was credited in this range.',
              hint: 'Try a different year, or check that the payouts you expect were recorded with the dates you expect.',
            }}
          />
        </>
      )}
    </Box>
  );
}
