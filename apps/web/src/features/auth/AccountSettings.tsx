import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import { useAuth } from '../../shared/api';
import { useToast } from '../../shared/feedback';

import { ChangeCredentialsForm } from './ChangeCredentialsForm';

/**
 * F16 — change the username or the password from inside the app.
 *
 * The same form as the cage, minus the urgency and plus a rename. The one
 * thing this screen says that the cage does not is what changing a credential
 * does to other sessions: UC13 revokes every session but this one, so a
 * browser left signed in elsewhere is signed out by this. That is the
 * intended behaviour and the reason to do it — a person changing a password
 * because they are worried needs to know it actually took effect.
 */
export function AccountSettings() {
  const { user } = useAuth();
  const { notify } = useToast();

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Account
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        Signed in as {user?.username ?? 'nobody'}.
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 460 }}>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Change username or password
        </Typography>
        <Typography variant="body2" sx={{ color: 'muted.main', mb: 3 }}>
          Changing either signs out every other browser this account is open in.
          This one stays signed in.
        </Typography>

        <ChangeCredentialsForm
          username={user?.username ?? ''}
          allowUsernameChange
          requireNewPassword={false}
          submitLabel="Save changes"
          onDone={(result) => {
            // Names what actually changed, rather than a generic "Saved":
            // somebody who meant to change both and typed into one field
            // should be able to tell from the confirmation.
            const changed = [
              result.usernameChanged ? 'Username' : null,
              result.passwordChanged ? 'password' : null,
            ]
              .filter((part) => part !== null)
              .join(' and ');

            notify(
              changed === ''
                ? 'Nothing changed'
                : `${changed.charAt(0).toUpperCase()}${changed.slice(1)} changed`,
            );
          }}
        />
      </Paper>
    </Box>
  );
}
