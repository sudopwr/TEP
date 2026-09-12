import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { ErrorState, PasswordField } from '../../shared/components';

/**
 * F14 — sign in. One account, no registration, no "forgot password".
 *
 * There is no recovery link because there is nothing to recover to: the app
 * is one process on one machine with one account, and a reset link would have
 * to mail itself somewhere. Losing the password means editing the database,
 * and pretending otherwise with a dead link would be worse than saying so.
 *
 * The failure message is the server's, unedited and identical for a wrong
 * password and an unknown username (§5a). Being more helpful here — "no such
 * user" — is precisely the help an attacker wants.
 */

interface RedirectState {
  readonly from?: { readonly pathname: string };
}

export function SignInScreen() {
  const { signIn, isSignedIn, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Where they were headed before the guard sent them here. Coming back to
  // the payout you clicked is the difference between signing in and starting
  // over.
  const intended = (location.state as RedirectState | null)?.from?.pathname;

  if (isSignedIn) {
    return (
      <Navigate
        to={mustChangePassword ? '/change-password' : '/payouts'}
        replace
      />
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (signIn.isPending) return;

    signIn.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (user) => {
          setPassword('');
          void navigate(
            user.mustChangePassword
              ? '/change-password'
              : (intended ?? '/payouts'),
            { replace: true },
          );
        },
      },
    );
  };

  const failure = signIn.error === null ? null : describeError(signIn.error);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
      }}
    >
      <Paper sx={{ p: 4, width: '100%', maxWidth: 380 }}>
        <Typography variant="h1" sx={{ fontSize: 20 }}>
          Payout tracker
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'muted.main', mt: 0.5, mb: 3 }}
        >
          Sign in to see your payouts.
        </Typography>

        <Box component="form" onSubmit={submit} noValidate>
          <TextField
            label="Username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            name="username"
            autoComplete="username"
            fullWidth
            size="small"
            required
            autoFocus
            disabled={signIn.isPending}
          />

          <Box sx={{ mt: 2 }}>
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              name="password"
              required
              disabled={signIn.isPending}
            />
          </Box>

          {failure === null ? null : (
            <Box sx={{ mt: 2 }}>
              <ErrorState
                message={failure.message}
                {...(failure.action === undefined
                  ? {}
                  : { detail: failure.action })}
              />
            </Box>
          )}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            sx={{ mt: 3 }}
            disabled={signIn.isPending}
          >
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
