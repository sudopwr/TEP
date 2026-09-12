import { describe, expect, it } from 'vitest';

import { FLAG, INK, NEGATIVE, PAPER, POSITIVE, inkAlpha } from './palette';
import { theme } from './theme';
import { MONO_STACK, NUMERIC_FEATURES, SANS_STACK } from './typography';

describe('the palette', () => {
  it('puts every semantic colour on the MUI palette', () => {
    // So a component can say what a value *means* rather than what it looks
    // like. `sx={{ color: 'negative.main' }}` only resolves because of this.
    expect(theme.palette.positive.main).toBe(POSITIVE);
    expect(theme.palette.negative.main).toBe(NEGATIVE);
    expect(theme.palette.flag.main).toBe(FLAG);
    expect(theme.palette.muted.main).toBe(inkAlpha(0.62));
  });

  it('points MUI own semantics at the same colours', () => {
    // An Alert reaching for `error` must land on the same rust as an amount
    // reaching for `negative`, or the screen has two reds meaning one thing.
    expect(theme.palette.error.main).toBe(NEGATIVE);
    expect(theme.palette.success.main).toBe(POSITIVE);
    expect(theme.palette.warning.main).toBe(FLAG);
  });

  it('is ink on paper, not blue on white', () => {
    // Naming MUI's default blue here to assert against it is exactly what
    // the no-raw-hex rule refuses, and it caught this line. It was redundant
    // anyway: primary being INK already says primary is not blue.
    expect(theme.palette.primary.main).toBe(INK);
    expect(theme.palette.background.default).toBe(PAPER);
  });

  it('derives muted from ink rather than choosing a second grey', () => {
    // A separately-picked grey drifts cool and reads as a different ink on a
    // warm ground. Muted must be the same colour, just quieter.
    expect(theme.palette.text.secondary.startsWith(INK)).toBe(true);
  });

  describe('inkAlpha', () => {
    it('appends an 8-bit alpha channel', () => {
      expect(inkAlpha(1)).toBe(`${INK}ff`);
      expect(inkAlpha(0)).toBe(`${INK}00`);
    });

    it('clamps rather than producing a malformed colour', () => {
      expect(inkAlpha(5)).toBe(`${INK}ff`);
      expect(inkAlpha(-1)).toBe(`${INK}00`);
    });

    it('always produces two hex digits', () => {
      // 0.02 * 255 rounds to 5, which must be `05` and not `5`.
      expect(inkAlpha(0.02)).toHaveLength(INK.length + 2);
    });
  });
});

describe('typography', () => {
  it('gives numbers the tabular mono stack', () => {
    const numeric = theme.typography.numeric;

    expect(numeric.fontFamily).toBe(MONO_STACK);
    expect(numeric.fontVariantNumeric).toBe(NUMERIC_FEATURES);
  });

  it('asks for tabular figures, lining figures and a slashed zero', () => {
    // Tabular so a column is a column; lining so a total sits on the
    // baseline; slashed so 0 and O are not a judgement call in a wallet
    // address.
    expect(NUMERIC_FEATURES).toContain('tabular-nums');
    expect(NUMERIC_FEATURES).toContain('lining-nums');
    expect(NUMERIC_FEATURES).toContain('slashed-zero');
  });

  it('repeats the features as OpenType tags, for fallback fonts', () => {
    // `font-variant-numeric` is the modern spelling and not every fallback
    // honours it; the raw tags cover the rest.
    expect(theme.typography.numeric.fontFeatureSettings).toContain('"tnum" 1');
    expect(theme.typography.numeric.fontFeatureSettings).toContain('"zero" 1');
  });

  it('names IBM Plex first in both stacks, with real fallbacks after', () => {
    expect(MONO_STACK.startsWith('"IBM Plex Mono"')).toBe(true);
    expect(SANS_STACK.startsWith('"IBM Plex Sans"')).toBe(true);
    expect(MONO_STACK).toContain('monospace');
    expect(SANS_STACK).toContain('sans-serif');
  });

  it('keeps the interface in the sans cut', () => {
    expect(theme.typography.fontFamily).toBe(SANS_STACK);
  });
});

describe('the rest of the theme', () => {
  it('uses an 8px spacing base', () => {
    expect(theme.spacing(1)).toBe('8px');
    expect(theme.spacing(4)).toBe('32px');
  });

  it('is flat — nothing on this page floats', () => {
    expect(new Set(theme.shadows).size).toBe(1);
    expect(theme.shadows[1]).toBe('none');
  });

  it('is light only, deliberately', () => {
    // Read beside printed statements and printed itself; a dark surface
    // fights both. Recorded here so removing it is a decision, not a drift.
    expect(theme.palette.mode).toBe('light');
  });
});
