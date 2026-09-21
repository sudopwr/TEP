import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import {
  MONTH_NAMES,
  useScope,
  usePayoutYears,
  useTraders,
  type PeriodPoint,
} from '../../shared/api';
import { SelectWithCreate } from '../../shared/components';

import { NewTraderDialog } from './NewTraderDialog';

/**
 * The bar at the top of every screen: whose money, and when (F24).
 *
 * The person first, because that is the larger cut, then the period as two
 * ends — a first month and a last one. **Not a single year**: a tax year does
 * not start in January, so "April 2024 to March 2025" has to be sayable, and
 * a year-with-a-month control cannot say it.
 *
 * Each select carries an "All" entry, because the application opens showing
 * everything and "All traders" is a real choice somebody comes back to, not
 * an empty state.
 *
 * The trader select is `SelectWithCreate`, so the person who is missing from
 * the list is added from inside the list — the same reasoning as the company
 * field on the payout form (§13), and the same dialog placement: it renders
 * outside anything that could be a form, because a portal is elsewhere in the
 * DOM but not elsewhere in the React tree.
 */

/**
 * The value of each "All" entry.
 *
 * A word rather than the empty string: MUI reads an empty value as "nothing
 * selected" and draws a blank box, so the choice somebody actually made —
 * every trader, all time — would look like a field they had forgotten to
 * fill in. No trader id, year or month can collide with it.
 */
const ALL = 'all';

const MONTH_OPTIONS = MONTH_NAMES.map((month, index) => ({
  value: String(index + 1),
  label: month,
}));

export function ScopeBar() {
  const scope = useScope();
  const traders = useTraders();
  const years = usePayoutYears();

  const [adding, setAdding] = useState(false);

  const offeredYears = yearsToOffer(years.data ?? []);
  const fallbackYear = offeredYears[0] ?? new Date().getUTCFullYear();

  /*
    Half a choice is still a choice.

    Picking a month before a year, or a year before a month, must narrow
    something — a control that waits for its neighbour does nothing and says
    nothing. So each half is completed from the other end, or from the latest
    year there is data for: a start defaults to January, an end to December,
    which is what "from 2024" and "to 2025" mean in a sentence.
  */
  const startFrom = (part: Partial<PeriodPoint>): void => {
    scope.setFrom({
      year: part.year ?? scope.from?.year ?? fallbackYear,
      month: part.month ?? scope.from?.month ?? 1,
    });
  };

  const endAt = (part: Partial<PeriodPoint>): void => {
    scope.setTo({
      year: part.year ?? scope.to?.year ?? fallbackYear,
      month: part.month ?? scope.to?.month ?? 12,
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 1.5,
        mb: 3,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ width: 200 }}>
        <SelectWithCreate
          label="Trader"
          value={scope.traderId === null ? ALL : String(scope.traderId)}
          onChange={(value) => {
            scope.setTraderId(value === ALL ? null : Number(value));
          }}
          options={[
            { value: ALL, label: 'All traders' },
            ...(traders.data ?? []).map((trader) => ({
              value: String(trader.id),
              label: trader.name,
            })),
          ]}
          createLabel="Add a trader…"
          onCreate={() => {
            setAdding(true);
          }}
        />
      </Box>

      {/*
        "From" and "To" are labelled on the fields themselves rather than by a
        heading above the pair: the rail is the only other thing on this line,
        and a four-field row with one caption reads as four separate filters.
      */}
      <PeriodEnd
        caption="From"
        point={scope.from}
        years={offeredYears}
        onMonth={(month) => {
          startFrom({ month });
        }}
        onYear={(year) => {
          startFrom({ year });
        }}
        onClear={() => {
          scope.setFrom(null);
        }}
      />

      <PeriodEnd
        caption="To"
        point={scope.to}
        years={offeredYears}
        onMonth={(month) => {
          endAt({ month });
        }}
        onYear={(year) => {
          endAt({ year });
        }}
        onClear={() => {
          scope.setTo(null);
        }}
      />

      {/*
        Only while something is narrowed. A permanently visible "Show
        everything" reads as an instruction on a screen that is already
        showing everything.
      */}
      {scope.isNarrowed ? (
        <Button
          color="inherit"
          size="small"
          sx={{ mt: 0.5 }}
          onClick={() => {
            scope.setTraderId(null);
            scope.setFrom(null);
          }}
        >
          Show everything
        </Button>
      ) : null}

      <NewTraderDialog
        open={adding}
        onCreated={(trader) => {
          setAdding(false);
          // Selecting them immediately is the point of adding them here: the
          // next thing somebody does is record that person's payout.
          scope.setTraderId(trader.id);
        }}
        onCancel={() => {
          setAdding(false);
        }}
      />
    </Box>
  );
}

/** One end of the period: its month and its year, under a small caption. */
function PeriodEnd({
  caption,
  point,
  years,
  onMonth,
  onYear,
  onClear,
}: {
  readonly caption: string;
  readonly point: PeriodPoint | null;
  readonly years: readonly number[];
  readonly onMonth: (month: number) => void;
  readonly onYear: (year: number) => void;
  readonly onClear: () => void;
}) {
  return (
    <Box>
      <Typography
        variant="label"
        component="span"
        sx={{ display: 'block', mb: 0.5, color: 'muted.main' }}
      >
        {caption}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box sx={{ width: 150 }}>
          <SelectWithCreate
            label={`${caption} month`}
            value={point === null ? ALL : String(point.month)}
            onChange={(value) => {
              if (value === ALL) {
                onClear();
                return;
              }
              onMonth(Number(value));
            }}
            options={[{ value: ALL, label: 'All time' }, ...MONTH_OPTIONS]}
          />
        </Box>

        <Box sx={{ width: 110 }}>
          <SelectWithCreate
            label={`${caption} year`}
            value={point === null ? ALL : String(point.year)}
            onChange={(value) => {
              if (value === ALL) {
                onClear();
                return;
              }
              onYear(Number(value));
            }}
            options={[
              { value: ALL, label: 'All time' },
              ...years.map((year) => ({
                value: String(year),
                label: String(year),
              })),
            ]}
          />
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The years to offer, newest first.
 *
 * Not simply the years there are payouts in: a financial year *starts* in the
 * year before the one it is named for, so a ledger holding only March 2025
 * still has to be able to say "from April 2024". The list therefore runs from
 * a year before the earliest payout to the later of the newest payout and
 * this year — the range a period could reasonably be cut from.
 */
function yearsToOffer(withPayouts: readonly number[]): readonly number[] {
  const thisYear = new Date().getUTCFullYear();
  const known = withPayouts.length > 0 ? withPayouts : [thisYear];

  const first = Math.min(...known) - 1;
  const last = Math.max(...known, thisYear);

  return Array.from({ length: last - first + 1 }, (_, index) => last - index);
}
