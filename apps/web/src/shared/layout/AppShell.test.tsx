import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { render, screen } from '../../../test/render';

import { AppShell, type Destination } from './AppShell';

/**
 * The rail, and the width it is supposed to be.
 *
 * This file exists because of a bug an end-to-end journey found and every
 * other test missed: `sx={{ width: 27 }}` is twenty-seven *pixels*, not
 * twenty-seven spacing units, so the rail was narrower than a single
 * character and its links were clipped out of existence. Nothing rendered
 * wrongly — the links were in the DOM, with the right text and the right
 * `href` — so every assertion anybody had written still passed. It took a
 * test that *clicked* one to notice.
 */

const DESTINATIONS: readonly Destination[] = [
  { label: 'Payouts', to: '/payouts' },
  { label: 'Data quality', to: '/data-quality' },
];

const shell = (props: Partial<Parameters<typeof AppShell>[0]> = {}) =>
  render(
    <MemoryRouter initialEntries={['/payouts']}>
      <AppShell destinations={DESTINATIONS} {...props}>
        <p>the page</p>
      </AppShell>
    </MemoryRouter>,
  );

describe('AppShell', () => {
  it('is wide enough to hold the longest destination', () => {
    // 27 spacing units at 8px. As a bare number it would be 27px, and
    // "Data quality" would have nowhere to go.
    shell();

    const rail = screen.getByRole('navigation', { name: 'Sections' });

    expect(window.getComputedStyle(rail).width).toBe('216px');
  });

  it('renders each destination as a link somebody can click', () => {
    shell();

    expect(screen.getByRole('link', { name: 'Payouts' })).toHaveAttribute(
      'href',
      '/payouts',
    );
    expect(screen.getByRole('link', { name: 'Data quality' })).toHaveAttribute(
      'href',
      '/data-quality',
    );
  });

  it('marks where you are with weight, not with a colour', () => {
    // The palette's three colours are facts about money. Spending one on
    // navigation would dilute all three.
    shell();

    const current = screen.getByRole('link', { name: 'Payouts' });

    expect(current).toHaveClass('active');
    expect(window.getComputedStyle(current).fontWeight).toBe('600');
  });

  it('shows the account menu only when somebody is signed in', () => {
    const { unmount } = shell();
    expect(
      screen.queryByRole('button', { name: /Account menu/ }),
    ).not.toBeInTheDocument();
    unmount();

    shell({ username: 'admin' });
    expect(
      screen.getByRole('button', { name: 'Account menu for admin' }),
    ).toBeInTheDocument();
  });
});
