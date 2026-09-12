import { createTheme, type Theme } from '@mui/material/styles';

import {
  FLAG,
  INK,
  MUTED,
  NEGATIVE,
  PAPER,
  POSITIVE,
  RULE,
  WASH,
  inkAlpha,
} from './palette';
import { MONO_STACK, NUMERIC_FEATURES, SANS_STACK, SIZES } from './typography';

/**
 * The semantic colours, added to MUI's palette so a component asks for a
 * meaning rather than for a colour.
 *
 * `sx={{ color: 'negative.main' }}` says what the value *is*; a hex says what
 * it looks like today. The `design/no-raw-hex` lint rule makes the second
 * impossible, and this declaration makes the first type-safe.
 */
declare module '@mui/material/styles' {
  interface Palette {
    positive: Palette['primary'];
    negative: Palette['primary'];
    flag: Palette['primary'];
    muted: Palette['primary'];
    rule: Palette['primary'];
  }

  interface PaletteOptions {
    positive: PaletteOptions['primary'];
    negative: PaletteOptions['primary'];
    flag: PaletteOptions['primary'];
    muted: PaletteOptions['primary'];
    rule: PaletteOptions['primary'];
  }

  interface TypographyVariants {
    /** Any number, code, hash or reference. Tabular, slashed zero. */
    numeric: React.CSSProperties;
    /** A column header or a field label. */
    label: React.CSSProperties;
  }

  interface TypographyVariantsOptions {
    numeric?: React.CSSProperties;
    label?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    numeric: true;
    label: true;
  }
}

/** 8px base. Row height is 4 units; the rail is 27. */
const SPACING = 8;

/**
 * One theme, and there is deliberately no second one.
 *
 * No dark mode: this tool is read beside printed statements and PDF exports,
 * and gets printed itself. A dark surface fights both. Every colour is already
 * a token, so adding a mode later is a palette swap rather than a rewrite.
 */
export const theme: Theme = createTheme({
  spacing: SPACING,

  palette: {
    mode: 'light',
    background: { default: PAPER, paper: PAPER },
    text: { primary: INK, secondary: MUTED, disabled: inkAlpha(0.38) },
    divider: RULE,

    // The chrome is ink. Primary is not a brand colour here — it is the
    // colour of a rule and a heading, which is the point.
    primary: { main: INK, contrastText: PAPER },
    secondary: { main: MUTED, contrastText: PAPER },

    positive: { main: POSITIVE, contrastText: PAPER },
    negative: { main: NEGATIVE, contrastText: PAPER },
    flag: { main: FLAG, contrastText: PAPER },
    muted: { main: MUTED, contrastText: PAPER },
    rule: { main: RULE, contrastText: INK },

    // MUI's own semantics point at ours, so a Chip or an Alert that reaches
    // for `error` lands on the same rust as everything else.
    success: { main: POSITIVE, contrastText: PAPER },
    error: { main: NEGATIVE, contrastText: PAPER },
    warning: { main: FLAG, contrastText: PAPER },
    info: { main: MUTED, contrastText: PAPER },
  },

  typography: {
    fontFamily: SANS_STACK,
    fontSize: SIZES.body,
    htmlFontSize: 16,

    h1: {
      fontFamily: SANS_STACK,
      fontSize: SIZES.page,
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h2: { fontFamily: SANS_STACK, fontSize: SIZES.section, fontWeight: 600 },
    h3: { fontFamily: SANS_STACK, fontSize: SIZES.body, fontWeight: 600 },

    body1: { fontSize: SIZES.body, lineHeight: 1.55 },
    body2: { fontSize: SIZES.label, lineHeight: 1.5 },
    caption: { fontSize: SIZES.small, color: MUTED },

    /**
     * Every amount, rate, hash and reference. The one variant that matters:
     * a column of these is a column, at any font size, in any fallback.
     */
    numeric: {
      fontFamily: MONO_STACK,
      fontSize: SIZES.body,
      fontVariantNumeric: NUMERIC_FEATURES,
      fontFeatureSettings: '"tnum" 1, "lnum" 1, "zero" 1',
      letterSpacing: 0,
      lineHeight: 1.45,
    },

    label: {
      fontFamily: SANS_STACK,
      fontSize: SIZES.label,
      fontWeight: 600,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: MUTED,
    },

    button: { textTransform: 'none', fontWeight: 600, fontSize: SIZES.body },
  },

  shape: { borderRadius: 3 },

  // Flat. A shadow implies a floating surface, and nothing here floats — it
  // is one page with rules on it. Keeping the array present but flat means
  // MUI components that index into it still work.
  shadows: Array.from({ length: 25 }, () => 'none') as Theme['shadows'],

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: PAPER,
          color: INK,
          // Numbers appear inside prose constantly; this makes the default
          // safe even where a component forgets the `numeric` variant.
          fontVariantNumeric: 'lining-nums',
        },
        // A number that can be selected and pasted is a number that can be
        // checked against a statement. Nothing here disables selection.
        'code, pre, samp': { fontFamily: MONO_STACK },
      },
    },

    MuiTypography: {
      defaultProps: {
        variantMapping: { numeric: 'span', label: 'span' },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${RULE}`,
          padding: `${SPACING * 0.75}px ${SPACING * 1.5}px`,
          fontSize: SIZES.body,
        },
        head: {
          fontWeight: 600,
          fontSize: SIZES.label,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: MUTED,
          whiteSpace: 'nowrap',
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: WASH } },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: `1px solid ${RULE}` },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' },
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 3, fontWeight: 600, fontSize: SIZES.small },
      },
    },

    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: INK, textDecorationColor: RULE } },
    },
  },
});
