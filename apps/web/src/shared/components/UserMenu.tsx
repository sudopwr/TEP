import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useState, type MouseEvent } from 'react';

/**
 * Who is signed in, and what they can do about it. Every fact arrives as a
 * prop; it reads no session and calls no endpoint.
 *
 * ```tsx
 * <UserMenu username="admin" onSignOut={signOut} />
 *
 * <UserMenu
 *   username="admin"
 *   mustChangePassword
 *   onChangeCredentials={openChangeScreen}
 *   onSignOut={signOut}
 * />
 *
 * <UserMenu
 *   username="kd"
 *   onSignOut={signOut}
 *   items={[{ label: 'Keyboard shortcuts', onClick: openShortcuts }]}
 * />
 * ```
 */

export interface UserMenuItem {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export interface UserMenuProps {
  readonly username: string;
  /**
   * Shows a standing marker next to the name, not a dismissible banner.
   *
   * While this is set the application's data routes are all closed (F15), so
   * the state is not a notification — it is the condition the person is in
   * until they act, and it should still be visible on their fourth visit.
   */
  readonly mustChangePassword?: boolean;
  readonly onChangeCredentials?: () => void;
  readonly onSignOut?: () => void;
  /** Anything else this application wants in the menu. */
  readonly items?: readonly UserMenuItem[];
  readonly disabled?: boolean;
}

export function UserMenu({
  username,
  mustChangePassword = false,
  onChangeCredentials,
  onSignOut,
  items = [],
  disabled = false,
}: UserMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;

  const close = (): void => {
    setAnchor(null);
  };

  /** Close first, then act: a menu still open over a new screen is a bug. */
  const choose = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <>
      <Button
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          setAnchor(event.currentTarget);
        }}
        disabled={disabled}
        color="inherit"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${username}`}
        sx={{ textTransform: 'none', gap: 0.75 }}
      >
        <Typography variant="numeric" component="span">
          {username}
        </Typography>
        {mustChangePassword ? (
          <Box
            component="span"
            title="The default password is still in place"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'flag.main',
            }}
          />
        ) : null}
      </Button>

      <Menu anchorEl={anchor} open={open} onClose={close}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="label" component="p">
            Signed in as
          </Typography>
          <Typography variant="numeric">{username}</Typography>
          {mustChangePassword ? (
            <Typography
              variant="body2"
              sx={{ color: 'flag.main', mt: 0.5, maxWidth: 220 }}
            >
              The default password is still in place.
            </Typography>
          ) : null}
        </Box>

        <Divider />

        {onChangeCredentials === undefined ? null : (
          <MenuItem onClick={choose(onChangeCredentials)}>
            Change username or password
          </MenuItem>
        )}

        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={choose(item.onClick)}
            disabled={item.disabled ?? false}
          >
            {item.label}
          </MenuItem>
        ))}

        {onSignOut === undefined ? null : (
          <MenuItem onClick={choose(onSignOut)}>Sign out</MenuItem>
        )}
      </Menu>
    </>
  );
}
