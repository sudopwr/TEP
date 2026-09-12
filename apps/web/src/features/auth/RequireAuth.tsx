import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../../shared/api';

/**
 * The protected-route wrappers. Two of them, because there are two gates.
 *
 * Both read `useAuth`, which is one `useQuery` on `/auth/me` — so the browser
 * and the server are answering the same question from the same fact, and a
 * 403 from any route anywhere updates that fact (see `queryClient.ts`). That
 * is what makes a stale tab impossible to sit on: the moment it asks the
 * server for anything, the answer routes it here.
 *
 * Neither of these is a security boundary. The server's guards are (§5a:
 * global, exemption-list, fail-closed). These exist so the person sees the
 * right screen, not so the data is protected — if this file were deleted
 * every data route would still answer 401 and 403.
 */

/** A spinner, not a sign-in screen — see below for why that matters. */
function Waiting() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
      <CircularProgress size={20} aria-label="Checking your session" />
    </Box>
  );
}

/**
 * Signed in, and past F15's cage. Everything that touches data.
 */
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const { isLoading, isSignedIn, mustChangePassword } = useAuth();
  const location = useLocation();

  // "Still asking" is not "signed out". Rendering the sign-in screen during
  // the first probe would flash it in front of somebody who is signed in, on
  // every single reload.
  if (isLoading) return <Waiting />;

  if (!isSignedIn) {
    // Carrying where they were going, so signing in resumes rather than
    // restarts. `replace` so Back does not return to a page they cannot see.
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  if (mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}

/**
 * Signed in, cage or no cage.
 *
 * The exact mirror of §5a's `MUST_CHANGE_EXEMPT` on the server: the screens
 * that must work *while* the flag is set, because they are how it gets
 * cleared. A change-password screen behind `RequireAuth` would redirect to
 * itself forever.
 */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const { isLoading, isSignedIn } = useAuth();
  const location = useLocation();

  if (isLoading) return <Waiting />;

  if (!isSignedIn) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
