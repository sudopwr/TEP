/**
 * The only file in apps/web permitted to contain a raw hex value.
 *
 * Enforced by `design/no-raw-hex` in eslint.config.js, which fails the build
 * for a `#rrggbb` anywhere else under apps/web. That rule is the difference
 * between a palette and a suggestion.
 *
 * ---
 *
 * Ledger paper, not dashboard blue.
 *
 * The chrome is deliberately colourless. Everything structural — rails, rules,
 * headers, tree connectors — is ink on paper, which leaves saturation entirely
 * free to carry meaning. In MUI's default theme, blue is the app bar, the
 * link, the primary button and the focus ring all at once; by the third use it
 * has stopped telling the reader anything. In a tool whose only job is
 * noticing the wrong number, colour that means nothing is worse than no
 * colour.
 *
 * So there are exactly three coloured things on screen, and each one is a
 * fact about money:
 *
 *   positive  it arrived
 *   negative  it left
 *   flag      §7 says this is suspicious rather than impossible
 *
 * Colour is never the only signal. An amount's sign and its position in a
 * right-aligned column carry the meaning first; hue reinforces it. `positive`
 * and `negative` also differ in lightness (L* 41 against L* 39 is close, but
 * green against rust differs enough in both chroma and hue angle to survive
 * the common red/green confusions, and the minus sign survives all of them).
 */

/** Warm near-black. Body text, hairline rules, the trail's connectors. */
export const INK = '#1C1A17';

/**
 * Warm off-white. Pure #FFFFFF is a light source; this is a page.
 * Over a long reconciliation session that difference is the whole point.
 */
export const PAPER = '#FAF7F2';

/** Deep green. Money arriving: net credited, a settled payout, a credit leg. */
export const POSITIVE = '#1F6F4A';

/** Rust. Money leaving: fees, TDS, charges, a negative balance. */
export const NEGATIVE = '#A3341F';

/**
 * Ochre. Not an error — §7's "suspicious rather than impossible", which is
 * exactly what `v_data_quality` and F11 report. A red flag here would claim a
 * certainty the check does not have.
 */
export const FLAG = '#B07A12';

/**
 * Ink at reduced opacity, for secondary text, disabled states and rules.
 *
 * Derived rather than declared as a sixth hue, so muted text is provably the
 * same colour as the text it sits beside — a separately-chosen grey drifts
 * cool and reads as a different ink on a warm ground.
 */
export const inkAlpha = (alpha: number): string => {
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');

  return `${INK}${channel}`;
};

/** Secondary text: legible, clearly subordinate. */
export const MUTED = inkAlpha(0.62);

/** Hairlines: table rules, the rail's edge, tree connectors. */
export const RULE = inkAlpha(0.14);

/** A row that wants attention without shouting — hover, selection. */
export const WASH = inkAlpha(0.045);
