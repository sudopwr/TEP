import {
  CHANGED_PASSWORD,
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  changedPassword,
  expect,
  field,
  shippedPassword,
} from './fixtures/world';

/**
 * Journeys 1-4: getting in, and staying out.
 *
 * Two fixtures, because F15 splits the application in half — a first run with
 * `admin` / `admin` still in place, and every day after that. The tests that
 * want one say so on their first line.
 */

// ---------- 1. Unauthenticated visit redirects to sign-in ----------

changedPassword(
  'a visit with no session lands on the sign-in screen',
  async ({ page }) => {
    await page.goto('/payouts');

    await expect(page).toHaveURL(/\/signin$/);
    await expect(
      page.getByRole('button', { name: 'Sign in' }),
    ).toBeVisible();

    // And nothing behind it leaked on the way past.
    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeHidden();
  },
);

// ---------- 2. The first run ----------

shippedPassword.describe('the first run', () => {
  shippedPassword(
    'forces the password change, refuses every way out, then opens the app',
    async ({ page, world }) => {
      await world.signIn(page, DEFAULT_PASSWORD);

      // Signing in with the shipped credential lands on the cage, not the app.
      await expect(
        page.getByRole('heading', {
          name: 'Choose a password before you start',
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/change-password$/);

      /*
        §5a's third constraint, checked three ways. The default password is
        only defensible while all of these hold.
      */

      // No rail to click, and nothing else to click either.
      await expect(
        page.getByRole('navigation', { name: 'Sections' }),
      ).toBeHidden();
      await expect(page.getByRole('link')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /skip|later|not now|dismiss/i }),
      ).toHaveCount(0);

      // A typed address does not escape it.
      await page.goto('/payouts');
      await expect(page).toHaveURL(/\/change-password$/);

      /*
        Nor does Back. Worth doing in this order: the attempt above is what
        puts a second entry in the history, and every redirect on the way here
        used `replace`, so the entry it left behind is the cage rather than the
        screen that was asked for. Pressing Back on a page you were bounced off
        must not return you to it.
      */
      await page.goBack();
      await expect(page).toHaveURL(/\/change-password$/);
      await expect(
        page.getByRole('heading', {
          name: 'Choose a password before you start',
        }),
      ).toBeVisible();

      // Now change it, through the real form.
      await field(page, 'Current password').fill(DEFAULT_PASSWORD);
      await field(page, 'New password').fill(CHANGED_PASSWORD);
      await field(page, 'New password again').fill(CHANGED_PASSWORD);
      await page
        .getByRole('button', { name: 'Set password and continue' })
        .click();

      // The payout list, and the cage is gone for good.
      await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
      await expect(page).toHaveURL(/\/payouts$/);
      await expect(
        page.getByRole('table', { name: 'Payouts' }).getByText(
          'TradeifyPayout001',
        ),
      ).toBeVisible();
    },
  );

  shippedPassword(
    'refuses a password the policy rejects, without leaving the screen',
    async ({ page, world }) => {
      await world.signIn(page, DEFAULT_PASSWORD);
      await expect(page).toHaveURL(/\/change-password$/);

      await field(page, 'Current password').fill(DEFAULT_PASSWORD);
      await field(page, 'New password').fill('short');
      await field(page, 'New password again').fill('short');
      await page
        .getByRole('button', { name: 'Set password and continue' })
        .click();

      await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
      await expect(page).toHaveURL(/\/change-password$/);
    },
  );
});

// ---------- 3. The new password works; the old one does not ----------

changedPassword.describe('after the password has been changed', () => {
  changedPassword('the old password is refused', async ({ page, world }) => {
    await world.signIn(page, DEFAULT_PASSWORD);

    // §5a's one message for every sign-in failure — and no hint about which
    // half of the credential was wrong.
    await expect(
      page.getByText('Incorrect username or password.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
  });

  changedPassword('the new password signs in', async ({ page, world }) => {
    await world.signIn(page, CHANGED_PASSWORD);

    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
    await expect(page).toHaveURL(/\/payouts$/);
  });
});

// ---------- 4. Signing out shuts the door behind you ----------

changedPassword(
  'signing out sends a typed address back to sign-in',
  async ({ page, world }) => {
    await world.signIn(page, CHANGED_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();

    await page
      .getByRole('button', { name: `Account menu for ${DEFAULT_USERNAME}` })
      .click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(
      page.getByRole('button', { name: 'Sign in' }),
    ).toBeVisible();

    // The point of the journey: not merely that the screen changed, but that
    // the session is actually gone on the server — a typed URL is the way
    // somebody would find out otherwise.
    await page.goto('/balances');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(
      page.getByRole('heading', { name: 'Balances' }),
    ).toBeHidden();
  },
);
