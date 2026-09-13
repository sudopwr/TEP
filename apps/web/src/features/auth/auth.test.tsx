import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  defaultPasswordStillSet,
  passwordChangeRequired,
  passwordRejected,
  signInRefused,
  signedOut,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { queryKeys } from '../../shared/api';
import { createQueryClient } from '../../shared/api/queryClient';
import { renderApp, screen, waitFor } from '../../../test/renderApp';

/**
 * The first-run path, driven through the whole application.
 *
 * These go through `renderApp` — the real providers, the real router, the
 * real `AuthProvider` — rather than rendering a screen in isolation, because
 * almost everything worth asserting here is about *where the person ends up*,
 * and a screen rendered on its own cannot be redirected away from.
 */

/**
 * Type into the field with this label.
 *
 * Matched with a function rather than a string, because MUI renders a
 * required field's label as `Username *` and an exact string match then finds
 * nothing — while a loose match on "New password" would also catch "New
 * password again". Stripping the asterisk and comparing exactly hits exactly
 * one field either way.
 */
const type = async (label: string, text: string): Promise<void> => {
  const field = screen.getByLabelText(
    (content: string) => content.replace(/\s*\*$/, '') === label,
  );

  await userEvent.type(field, text);
};

describe('signing in', () => {
  it('sends somebody who is not signed in to the sign-in screen', async () => {
    server.use(signedOut());

    renderApp({ route: '/payouts' });

    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it('does not flash the sign-in screen while it is still asking', () => {
    // "Still asking" is not "signed out". Getting this wrong shows the sign-in
    // form to somebody who is signed in, on every reload.
    renderApp({ route: '/payouts' });

    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Checking your session')).toBeInTheDocument();
  });

  it('gives one message for a failure, and no hint which half was wrong', async () => {
    server.use(signedOut(), signInRefused());

    renderApp({ route: '/payouts' });
    await screen.findByRole('button', { name: 'Sign in' });

    await type('Username', 'admin');
    await type('Password', 'not-the-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // The server's sentence, unedited. Saying "no such user" here would be
    // exactly the help §5a's timing equalisation exists to withhold.
    expect(
      await screen.findByText('That username and password did not match.'),
    ).toBeInTheDocument();
  });

  it('lands on the payout list when the password is not the default', async () => {
    server.use(signedOut());

    renderApp({ route: '/payouts' });
    await screen.findByRole('button', { name: 'Sign in' });

    await type('Username', 'admin');
    await type('Password', 'a quiet harbour lamp');

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Payouts' }),
    ).toBeInTheDocument();
  });
});

describe('the first run, with the shipped password still in place', () => {
  it('lands on the change-password screen after signing in as admin', async () => {
    server.use(signedOut(), ...defaultPasswordStillSet());

    renderApp({ route: '/payouts' });
    await screen.findByRole('button', { name: 'Sign in' });

    await type('Username', 'admin');
    await type('Password', 'admin');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Choose a password before you start',
      }),
    ).toBeInTheDocument();
  });

  it('offers no way past it — no rail, no skip, no dismissal', async () => {
    /*
      The three absences §5a depends on. A greyed-out nav is still a nav, and
      the first thing anybody does with a greyed-out link is look for the way
      round it; a skip button could only lead somewhere the server answers 403
      to; and a dismissible banner is a suggestion.
    */
    server.use(...defaultPasswordStillSet());

    renderApp({ route: '/payouts' });
    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    expect(
      screen.queryByRole('navigation', { name: 'Sections' }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /skip|later|not now|dismiss/i }),
    ).not.toBeInTheDocument();
  });

  it('says where the password came from and why it is safe so far', async () => {
    server.use(...defaultPasswordStillSet());

    renderApp({ route: '/payouts' });
    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    expect(screen.getByText(/so did every other copy/i)).toBeInTheDocument();
    expect(screen.getByText(/anywhere but this machine/i)).toBeInTheDocument();
  });

  it('catches a short password before the server has to', async () => {
    // The same `checkPasswordPolicy` the server runs, imported from core —
    // not a second implementation that can drift from it.
    server.use(...defaultPasswordStillSet());

    renderApp({ route: '/payouts' });
    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    await type('Current password', 'admin');
    await type('New password', 'short');
    await type('New password again', 'short');
    await userEvent.click(
      screen.getByRole('button', { name: 'Set password and continue' }),
    );

    expect(
      await screen.findByText(/at least 12 characters/i),
    ).toBeInTheDocument();
  });

  it("shows the server's own verdict when it refuses one we allowed", async () => {
    server.use(...defaultPasswordStillSet(), passwordRejected(['too_common']));

    renderApp({ route: '/payouts' });
    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    await type('Current password', 'admin');
    await type('New password', 'a quiet harbour lamp');
    await type('New password again', 'a quiet harbour lamp');
    await userEvent.click(
      screen.getByRole('button', { name: 'Set password and continue' }),
    );

    expect(await screen.findByText(/guessed first/i)).toBeInTheDocument();
  });

  it('goes to the payout list once it is changed, and never comes back', async () => {
    server.use(...defaultPasswordStillSet());

    renderApp({ route: '/payouts' });
    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    await type('Current password', 'admin');
    await type('New password', 'a quiet harbour lamp');
    await type('New password again', 'a quiet harbour lamp');

    // From here the server answers as it would once the flag is clear.
    server.resetHandlers();
    await userEvent.click(
      screen.getByRole('button', { name: 'Set password and continue' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Payouts' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Choose a password before you start',
      }),
    ).not.toBeInTheDocument();
  });

  it('turns anybody who visits the screen away once it is done', async () => {
    renderApp({ route: '/change-password' });

    // Already changed, so there is nothing to do here — but they arrived
    // meaning to change a credential, so account settings is where they go.
    expect(
      await screen.findByRole('heading', { name: 'Account' }),
    ).toBeInTheDocument();
  });
});

describe('a stale tab sitting on a data screen', () => {
  it('is routed to the change screen by the 403, from anywhere', async () => {
    /*
      The case the cage would otherwise miss. This tab was opened while the
      flag was clear, so its cached `/auth/me` says `mustChangePassword:
      false` — but the server now answers 403 to every data route. The 403 is
      handled once, in the query cache, by writing the truth onto the auth
      entry; the guard reads that entry and the redirect follows. No call site
      participates.
    */
    server.use(passwordChangeRequired('/api/payouts'));

    // Seeded, not fetched: that is what makes the tab stale. The auth query
    // holds for five minutes, so nothing will re-ask `/auth/me` on its own
    // and the 403 is the only thing that can move this tab.
    const client = createQueryClient();
    client.setQueryData(queryKeys.auth.me(), {
      username: 'admin',
      mustChangePassword: false,
    });

    renderApp({ route: '/payouts', client });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'Choose a password before you start',
        }),
      ).toBeInTheDocument();
    });
  });
});

describe('account settings', () => {
  it('changes the username without demanding a new password', async () => {
    renderApp({ route: '/account' });
    await screen.findByRole('heading', { name: 'Account' });

    await type('Current password', 'a quiet harbour lamp');
    await type('New username', 'kd');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    // The handler reports a username change of its own; what matters here is
    // that the form submitted at all with the password box left empty.
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed/i);
  });

  it('says plainly that other sessions are signed out', async () => {
    // UC13 revokes every session but this one. Somebody changing a password
    // because they are worried needs to know it actually took effect.
    renderApp({ route: '/account' });

    expect(
      await screen.findByText(/signs out every other browser/i),
    ).toBeInTheDocument();
  });
});

describe('the cage, once it has done its job', () => {
  it('does not bounce away when the flag clears underneath it', async () => {
    /*
      The bug an end-to-end run found, pinned here where it is cheap.

      A successful change clears `mustChangePassword`, which re-renders this
      screen. Read live, its "you do not belong here" redirect then fires on
      the success of the very change it was guarding, and races the navigation
      to the payout list — the reward for choosing a password was being
      dropped on account settings. The question the screen asks is about
      *arrival*, so it is answered once, at mount.
    */
    server.use(...defaultPasswordStillSet());

    const client = createQueryClient();
    renderApp({ route: '/payouts', client });

    await screen.findByRole('heading', {
      name: 'Choose a password before you start',
    });

    // The server says the flag is gone, exactly as it would after UC13.
    client.setQueryData(queryKeys.auth.me(), {
      username: 'admin',
      mustChangePassword: false,
    });

    // The screen stays put rather than redirecting itself away.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Set password and continue' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: 'Account' }),
    ).not.toBeInTheDocument();
  });
});
