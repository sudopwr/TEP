import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * The five places this application goes.
 *
 * A fixed rail rather than a collapsible drawer: there is one user, five
 * destinations, and no mobile target. A hamburger would hide a list short
 * enough to read at a glance, and cost a click every time it was opened.
 *
 * Only Balances is built. The rest are listed because the shape of the app is
 * itself a design decision and this is where it is recorded — and because a
 * rail that grows one item at a time never gets sized properly.
 */
const DESTINATIONS = [
  { label: 'Payouts', built: false },
  { label: 'Balances', built: true },
  { label: 'Documents', built: false },
  { label: 'Data quality', built: false },
  { label: 'Report', built: false },
] as const;

/** 27 spacing units — wide enough for "Data quality" without wrapping. */
const RAIL_WIDTH = 27;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="nav"
        aria-label="Sections"
        sx={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          px: 2,
          py: 3,
        }}
      >
        <Typography
          variant="label"
          component="h2"
          sx={{ display: 'block', mb: 2 }}
        >
          Payout tracker
        </Typography>

        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {DESTINATIONS.map((destination) => (
            <Box
              component="li"
              key={destination.label}
              aria-current={destination.built ? 'page' : undefined}
              sx={{
                py: 0.75,
                fontWeight: destination.built ? 600 : 400,
                color: destination.built ? 'text.primary' : 'muted.main',
              }}
            >
              {destination.label}
            </Box>
          ))}
        </Box>
      </Box>

      {/*
        One column with a ceiling. A settlement table stretched across a
        27-inch monitor puts the account and its amount too far apart to
        connect by eye, which is the one thing this screen exists for.
      */}
      <Box component="main" sx={{ flex: 1, px: 4, py: 3, maxWidth: 1100 }}>
        {children}
      </Box>
    </Box>
  );
}
