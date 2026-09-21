import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState } from 'react';

import {
  MONTH_NAMES,
  useScope,
  usePayoutYears,
  useTraders,
} from '../../shared/api';
import { SelectWithCreate } from '../../shared/components';

import { NewTraderDialog } from './NewTraderDialog';

/**
 * The bar at the top of every screen: whose money, and when (F24).
 *
 * Three controls in the order the question is asked — the person first,
 * because that is the larger cut, then the year, then the month inside it.
 * Each is a plain select with an "All" entry at the top, because the
 * application opens showing everything and "All traders" is a real choice
 * somebody comes back to, not an empty state.
 *
 * The trader select is `SelectWithCreate`, so the person who is missing from
 * the list is added from inside the list — the same reasoning as the company
 * field on the payout form (§13), and the same dialog placement: it renders
 * outside anything that could be a form, because a portal is elsewhere in the
 * DOM but not elsewhere in the React tree.
 *
 * The month is disabled until a year is chosen. "March" of no particular year
 * is not a period this application can fetch, and offering it would be a
 * control that silently does nothing.
 */

/**
 * The value of each "All" entry.
 *
 * A word rather than the empty string: MUI reads an empty value as "nothing
 * selected" and draws a blank box, so the choice somebody actually made —
 * every trader, all time — would look like a field they had forgotten to
 * fill in. No trader id or year can collide with it.
 */
const ALL = 'all';

export function ScopeBar() {
  const scope = useScope();
  const traders = useTraders();
  const years = usePayoutYears();

  const [adding, setAdding] = useState(false);

  const options = (traders.data ?? []).map((trader) => ({
    value: String(trader.id),
    label: trader.name,
  }));

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        mb: 3,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ width: 220 }}>
        <SelectWithCreate
          label="Trader"
          value={scope.traderId === null ? ALL : String(scope.traderId)}
          onChange={(value) => {
            scope.setTraderId(value === ALL ? null : Number(value));
          }}
          options={[{ value: ALL, label: 'All traders' }, ...options]}
          createLabel="Add a trader…"
          onCreate={() => {
            setAdding(true);
          }}
        />
      </Box>

      <Box sx={{ width: 140 }}>
        <SelectWithCreate
          label="Year"
          value={scope.year === null ? ALL : String(scope.year)}
          onChange={(value) => {
            scope.setYear(value === ALL ? null : Number(value));
          }}
          options={[
            { value: ALL, label: 'All time' },
            ...(years.data ?? []).map((year) => ({
              value: String(year),
              label: String(year),
            })),
          ]}
        />
      </Box>

      <Box sx={{ width: 160 }}>
        <SelectWithCreate
          label="Month"
          value={scope.month === null ? ALL : String(scope.month)}
          onChange={(value) => {
            scope.setMonth(value === ALL ? null : Number(value));
          }}
          disabled={scope.year === null}
          options={[
            { value: ALL, label: 'All months' },
            ...MONTH_NAMES.map((month, index) => ({
              value: String(index + 1),
              label: month,
            })),
          ]}
          {...(scope.year === null ? { helperText: 'Pick a year first.' } : {})}
        />
      </Box>

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
            scope.setYear(null);
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
