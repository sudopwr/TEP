import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { UserMenu } from '../components/UserMenu';

/**
 * The frame: a fixed rail on the left, one column of page on the right.
 *
 * A rail rather than a collapsible drawer. There is one user, six
 * destinations and no mobile target, so a hamburger would hide a list short
 * enough to read at a glance and cost a click every time it was opened.
 *
 * Prop-driven, like everything else under `shared/`: the destinations are
 * passed in rather than written here, so the shell knows about navigation
 * without knowing about payouts. `src/routes.tsx` is where the two meet.
 */

export interface Destination {
  readonly label: string;
  readonly to: string;
  /** Match nested paths too — `/payouts` stays current on `/payouts/1`. */
  readonly end?: boolean;
}

export interface AppShellProps {
  readonly destinations: readonly Destination[];
  readonly children: ReactNode;
  /** Omitted while nobody is signed in; the menu then does not render. */
  readonly username?: string;
  readonly mustChangePassword?: boolean;
  readonly onSignOut?: () => void;
  readonly onAccountSettings?: () => void;
  /**
   * A strip above the page, on every screen (F24's scope bar).
   *
   * A slot rather than the bar itself: `shared/` may not reach into a
   * feature, and the selection is a feature's business. `routes.tsx` puts one
   * in, the same way it hands over the destinations.
   */
  readonly toolbar?: ReactNode;
}

/** 27 spacing units — wide enough for "Data quality" without wrapping. */
const RAIL_WIDTH = 27;

/*
  Through `theme.spacing`, not as a bare number.

  `sx={{ width: 27 }}` is twenty-seven *pixels*: MUI's sizing system reads a
  number above 1 as px and only `spacing`-aware props multiply. The rail was
  27px wide and its links were clipped to nothing — invisible to a click and,
  since no test had ever clicked one, invisible to the suite as well. The
  first end-to-end journey that tried to navigate found it immediately.
*/
const railWidth = (theme: { spacing: (value: number) => string }): string =>
  theme.spacing(RAIL_WIDTH);

export function AppShell({
  destinations,
  children,
  username,
  mustChangePassword = false,
  onSignOut,
  onAccountSettings,
  toolbar,
}: AppShellProps) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="nav"
        aria-label="Sections"
        sx={{
          width: railWidth,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          px: 2,
          py: 3,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography
          variant="label"
          component="h2"
          sx={{ display: 'block', mb: 2 }}
        >
          Payout tracker
        </Typography>

        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, flex: 1 }}>
          {destinations.map((destination) => (
            <Box component="li" key={destination.to} sx={{ py: 0.25 }}>
              <Box
                component={NavLink}
                to={destination.to}
                end={destination.end ?? false}
                sx={{
                  display: 'block',
                  py: 0.5,
                  color: 'muted.main',
                  textDecoration: 'none',
                  // Weight and ink carry "you are here", not a coloured pill:
                  // the palette's three colours are reserved for facts about
                  // money, and spending one on navigation would dilute them.
                  '&.active': { color: 'text.primary', fontWeight: 600 },
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {destination.label}
              </Box>
            </Box>
          ))}
        </Box>

        {username === undefined ? null : (
          <Box sx={{ mt: 2 }}>
            <UserMenu
              username={username}
              mustChangePassword={mustChangePassword}
              {...(onChangeCredentialsProps(onAccountSettings))}
              {...(onSignOut === undefined ? {} : { onSignOut })}
            />
          </Box>
        )}
      </Box>

      {/*
        One column with a ceiling. A settlement table stretched across a
        27-inch monitor puts the account and its amount too far apart to
        connect by eye, which is the one thing this screen exists for.
      */}
      <Box component="main" sx={{ flex: 1, px: 4, py: 3, maxWidth: 1100 }}>
        {toolbar}
        {children}
      </Box>
    </Box>
  );
}

/** `exactOptionalPropertyTypes` refuses `{ onChangeCredentials: undefined }`. */
function onChangeCredentialsProps(handler?: () => void) {
  return handler === undefined ? {} : { onChangeCredentials: handler };
}
