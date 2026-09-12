import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';

import { useAuth } from '../../shared/api';
import { describeError, policyViolations } from '../../shared/api/errors';
import { ErrorState, PasswordField } from '../../shared/components';
import type { CredentialsChangedJson } from '../../shared/api';

import { assessPassword, describeViolation } from './passwordStrength';

/**
 * The one form that changes a credential, used by both screens that do.
 *
 * The forced first-run screen and the ordinary account settings differ in
 * their framing and in whether a new password is optional — not in what they
 * submit. Writing it once means the policy feedback, the confirmation field
 * and the server's own violation list behave identically in both places.
 */

export interface ChangeCredentialsFormProps {
  /** The current username. The policy needs it — a password may not be it. */
  readonly username: string;
  /** Settings allows a rename; the first-run cage is about the password. */
  readonly allowUsernameChange: boolean;
  /** True on the forced screen: a password change is the only way out. */
  readonly requireNewPassword: boolean;
  readonly submitLabel: string;
  readonly onDone: (result: CredentialsChangedJson) => void;
}

export function ChangeCredentialsForm({
  username,
  allowUsernameChange,
  requireNewPassword,
  submitLabel,
  onDone,
}: ChangeCredentialsFormProps) {
  const { changeCredentials } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showProblems, setShowProblems] = useState(false);

  const intendedUsername =
    allowUsernameChange && newUsername.trim() !== ''
      ? newUsername.trim()
      : username;

  const assessment = assessPassword(newPassword, {
    username: intendedUsername,
    currentPassword,
  });

  const changingPassword = requireNewPassword || newPassword !== '';
  const mismatch = changingPassword && confirmation !== newPassword;

  // The server's verdict, which outranks ours — it may know about a rule this
  // build does not, and it is the only one that actually refuses.
  const serverProblems = policyViolations(changeCredentials.error).map(
    describeViolation,
  );

  const problems =
    serverProblems.length > 0 ? serverProblems : assessment.problems;

  const ready =
    currentPassword !== '' &&
    (changingPassword ? assessment.ok && !mismatch : newUsername.trim() !== '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setShowProblems(true);

    if (!ready || changeCredentials.isPending) return;

    changeCredentials.mutate(
      {
        currentPassword,
        ...(changingPassword ? { newPassword } : {}),
        ...(allowUsernameChange && newUsername.trim() !== ''
          ? { newUsername: newUsername.trim() }
          : {}),
      },
      {
        onSuccess: (result) => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmation('');
          setNewUsername('');
          onDone(result);
        },
      },
    );
  };

  const failure =
    changeCredentials.error === null || serverProblems.length > 0
      ? null
      : describeError(changeCredentials.error);

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <PasswordField
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        name="currentPassword"
        required
        autoFocus
        helperText="Checked first, so this form is never a way to test whether a username exists."
        disabled={changeCredentials.isPending}
      />

      {allowUsernameChange ? (
        <TextField
          label="New username"
          value={newUsername}
          onChange={(event) => {
            setNewUsername(event.target.value);
          }}
          name="newUsername"
          fullWidth
          size="small"
          autoComplete="username"
          sx={{ mt: 2 }}
          helperText={`Leave blank to stay ${username}.`}
          disabled={changeCredentials.isPending}
        />
      ) : null}

      <Box sx={{ mt: 2 }}>
        <PasswordField
          label={
            requireNewPassword ? 'New password' : 'New password (optional)'
          }
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          name="newPassword"
          required={requireNewPassword}
          strength={assessment.strength}
          disabled={changeCredentials.isPending}
          helperText="Twelve characters or more. A phrase you will remember beats a short one you will write down."
        />
      </Box>

      {changingPassword ? (
        <Box sx={{ mt: 2 }}>
          <PasswordField
            label="New password again"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            name="confirmation"
            required
            disabled={changeCredentials.isPending}
            {...(mismatch && confirmation !== ''
              ? { error: 'The two do not match yet.' }
              : {})}
          />
        </Box>
      ) : null}

      {showProblems && problems.length > 0 ? (
        <Box component="ul" sx={{ mt: 2, mb: 0, pl: 2.5 }} role="list">
          {problems.map((problem) => (
            <Typography
              component="li"
              key={problem}
              variant="body2"
              sx={{ color: 'negative.main' }}
            >
              {problem}
            </Typography>
          ))}
        </Box>
      ) : null}

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
        sx={{ mt: 3 }}
        disabled={changeCredentials.isPending}
      >
        {changeCredentials.isPending ? 'Saving…' : submitLabel}
      </Button>
    </Box>
  );
}
