import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';

/**
 * A password input with a reveal toggle and a strength meter it does not
 * compute.
 *
 * ```tsx
 * <PasswordField value={password} onChange={setPassword} />
 *
 * <PasswordField
 *   label="New password"
 *   value={password}
 *   onChange={setPassword}
 *   strength={{ score: 3, label: 'Long enough' }}
 *   helperText="At least 12 characters."
 * />
 *
 * // The policy lives in core; this renders whatever verdict it produced.
 * <PasswordField
 *   value={password}
 *   onChange={setPassword}
 *   strength={{ score: 0, label: 'Too short' }}
 *   error="Password rejected: too_short, same_as_username."
 * />
 * ```
 */

/**
 * A verdict computed elsewhere.
 *
 * Deliberately not computed here. The real policy is a pure function in
 * `packages/core/src/domain/password-policy.ts` and the server applies it on
 * every change; a second implementation living in a text field would drift
 * from it, and the drift would show up as a field saying "strong" about a
 * password the server then rejects.
 */
export interface PasswordStrength {
  /** 0-4. Rendered as a bar; 0 is an empty bar, not a hidden one. */
  readonly score: 0 | 1 | 2 | 3 | 4;
  /** The word next to the bar. Also from the caller. */
  readonly label?: string;
}

export interface PasswordFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly name?: string;
  /** `current-password` when signing in, `new-password` when changing. */
  readonly autoComplete?: 'current-password' | 'new-password';
  readonly strength?: PasswordStrength;
  readonly helperText?: string;
  /** A message in the negative colour. Overrides `helperText`. */
  readonly error?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly autoFocus?: boolean;
  readonly onSubmitKey?: () => void;
}

/** 0 and 1 are weak, 2 is passable, 3 and 4 are fine. */
function strengthColor(score: number): string {
  if (score <= 1) return 'negative.main';
  if (score === 2) return 'flag.main';
  return 'positive.main';
}

export function PasswordField({
  value,
  onChange,
  label = 'Password',
  name,
  autoComplete = 'current-password',
  strength,
  helperText,
  error,
  disabled = false,
  required = false,
  autoFocus = false,
  onSubmitKey,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const meterId = useId();

  return (
    <Box>
      <TextField
        type={revealed ? 'text' : 'password'}
        label={label}
        value={value}
        {...(name === undefined ? {} : { name })}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        fullWidth
        size="small"
        error={error !== undefined}
        helperText={error ?? helperText}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmitKey !== undefined) {
            onSubmitKey();
          }
        }}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => {
                    setRevealed((shown) => !shown);
                  }}
                  edge="end"
                  size="small"
                  disabled={disabled}
                  // The label states the action, and it changes with the
                  // state — a screen reader user otherwise cannot tell
                  // whether the password is currently visible.
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                  aria-pressed={revealed}
                  // Never a submit button: inside a form, a button with no
                  // explicit type submits it, and revealing your password
                  // would attempt a sign-in.
                  type="button"
                >
                  <Typography variant="body2" sx={{ color: 'muted.main' }}>
                    {revealed ? 'Hide' : 'Show'}
                  </Typography>
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      {strength === undefined ? null : (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={(strength.score / 4) * 100}
            aria-label="Password strength"
            aria-describedby={meterId}
            sx={{
              height: 4,
              backgroundColor: 'divider',
              '& .MuiLinearProgress-bar': {
                backgroundColor: strengthColor(strength.score),
              },
            }}
          />
          {strength.label === undefined ? null : (
            <Typography
              id={meterId}
              variant="body2"
              sx={{ mt: 0.5, color: strengthColor(strength.score), fontSize: 11 }}
            >
              {strength.label}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
