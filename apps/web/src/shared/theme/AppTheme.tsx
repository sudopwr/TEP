import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';

import { theme } from './theme';

/**
 * The theme, the baseline, and the fonts, in one place.
 *
 * The `@fontsource` imports are here rather than in `main.tsx` so that a test
 * rendering a component through this provider is exercising the same font
 * stack the browser gets. They resolve to local files — §11 makes this an
 * offline tool, so nothing is fetched from a CDN at runtime.
 *
 * Only the weights actually used are imported. Pulling the whole family would
 * add about 400KB of woff2 that never renders.
 */
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';

export function AppTheme({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
