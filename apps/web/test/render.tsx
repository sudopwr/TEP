import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AppTheme } from '../src/shared/theme/AppTheme';

/**
 * Render inside the real theme, never a bare component.
 *
 * A component tested outside `ThemeProvider` gets MUI's default palette, so
 * `color: 'negative.main'` silently resolves to nothing and a test asserting
 * on colour passes against the wrong theme — or worse, throws on a palette key
 * that only exists in ours. Rendering through the real provider means a test
 * exercises the tokens the browser will.
 */
export function renderWithTheme(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppTheme>{children}</AppTheme>
    ),
    ...options,
  });
}

export * from '@testing-library/react';
export { renderWithTheme as render };

/**
 * An element's colour, normalised to lower-case `#rrggbb`.
 *
 * `getComputedStyle` returns whatever the DOM implementation prefers —
 * happy-dom keeps the authored hex, browsers and jsdom return `rgb(...)`. A
 * test that asserts on one of those forms is asserting on the DOM library.
 * Normalising lets a test compare against the palette token itself, which is
 * the thing it actually means.
 */
export function computedColor(element: Element): string {
  const raw = window.getComputedStyle(element).color.trim();

  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
  if (rgb === null) {
    return raw.toLowerCase();
  }

  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}
