import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../../shared/api';
import { useToast } from '../../shared/feedback';

import { ChangeCredentialsForm } from './ChangeCredentialsForm';

/**
 * F15 — the cage. The first thing anybody sees after signing in as `admin`.
 *
 * Three things are deliberately absent, and each one is absent because
 * §5a's default password is only defensible while all three stay absent:
 *
 *   - **no navigation.** This screen renders outside `AppShell`, so there is
 *     no rail, no links and nothing to click towards. A nav bar with the
 *     sections greyed out would still be a nav bar, and the first thing a
 *     person does with a greyed-out link is look for the way round it.
 *   - **no skip, no "later".** The server would refuse anyway — every data
 *     route answers 403 while the flag is set — so a skip button could only
 *     lead somewhere that does not work. Offering it would be a lie told by
 *     the interface about what the server will do.
 *   - **no dismissible banner.** A banner is a suggestion. This is not.
 *
 * The copy says plainly what is true: the password shipped with the app, it
 * is the same on every copy, and it works on this machine only. Somebody who
 * understands *why* is far likelier to choose a real password than somebody
 * being told to satisfy a rule.
 */
export function ChangePasswordScreen() {
  const { user, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  /*
    Was this screen needed when we arrived? Decided once, at mount.

    The question below is about *arrival*, not about now, and writing it that
    way is what makes it safe. Read live, the redirect fires on the success of
    the very change it is guarding: the flag clears, this component re-renders,
    and `Navigate` beats the navigation in `onDone` — so the reward for
    choosing a password is being dropped on account settings. An end-to-end
    run caught exactly that, on a path a unit test had been passing.

    `RequireSession` renders a spinner until `/auth/me` has answered, so the
    flag is already true or already false by the time this mounts. There is no
    third state to catch.
  */
  const [wasCaged] = useState(mustChangePassword);

  // Somebody who has already changed it does not belong here. Sending them to
  // account settings rather than away entirely: arriving at this URL means
  // they meant to change a credential, and that is where that is done.
  if (!wasCaged) {
    return <Navigate to="/account" replace />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
      }}
    >
      <Paper sx={{ p: 4, width: '100%', maxWidth: 460 }}>
        <Typography variant="h1" sx={{ fontSize: 20 }}>
          Choose a password before you start
        </Typography>

        <Typography variant="body2" sx={{ color: 'muted.main', mt: 1.5 }}>
          This copy of the application shipped with the password{' '}
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            admin
          </Box>
          , and so did every other copy. It works only because the server
          refuses to accept a connection from anywhere but this machine while it
          is still in place.
        </Typography>

        <Typography
          variant="body2"
          sx={{ color: 'muted.main', mt: 1.5, mb: 3 }}
        >
          Nothing else opens until it is changed — the payouts, the documents
          and the reports all answer &ldquo;change your password&rdquo; until
          then.
        </Typography>

        <ChangeCredentialsForm
          username={user?.username ?? 'admin'}
          allowUsernameChange={false}
          requireNewPassword
          submitLabel="Set password and continue"
          onDone={() => {
            notify('Password changed');
            // Straight to the payout list, and they never see this again:
            // the flag is now clear, so the guard above redirects anybody who
            // comes back to this URL.
            void navigate('/payouts', { replace: true });
          }}
        />
      </Paper>
    </Box>
  );
}
