/**
 * Two cuts of one family: IBM Plex Sans for the interface, IBM Plex Mono for
 * anything a person might need to read character by character.
 *
 * Self-hosted through `@fontsource`, never a CDN. §11 settles this: the app is
 * an offline local tool, and a `fonts.googleapis.com` link would mean the
 * interface degrades when the machine has no network — and would tell Google
 * every time the owner opens their own accounts.
 *
 * One family for both roles because a mono amount sits *inside* sans prose
 * constantly here ("net credited ₹84,642.93"). Two unrelated families make
 * that read as two voices; Plex Sans and Plex Mono share skeletons, so the
 * amount reads as emphasis rather than as an intrusion.
 */

/**
 * Every number, code, hash, reference and date.
 *
 * `tabular-nums` is the point. Plex Mono is fixed-pitch so its digits already
 * align, but the declaration also covers the fallbacks — on a machine where
 * the font has not loaded, Consolas and Menlo still align, and the column does
 * not reflow when it arrives. `slashed-zero` is the audit part: `0` and `O`
 * must not be a judgement call when you are checking a wallet address.
 */
export const MONO_STACK = [
  '"IBM Plex Mono"',
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Consolas',
  '"Liberation Mono"',
  'monospace',
].join(', ');

export const SANS_STACK = [
  '"IBM Plex Sans"',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');

/**
 * Applied to every numeric surface. `tabular-nums` fixes digit width so a
 * column of amounts is a column; `slashed-zero` distinguishes 0 from O; and
 * `lining-nums` keeps digits on one baseline, since Plex's default figures in
 * some cuts sit below it and make a total look like a footnote.
 */
export const NUMERIC_FEATURES =
  'tabular-nums lining-nums slashed-zero' as const;

/**
 * A modest scale. This is a reading tool, not a landing page: the largest
 * thing on screen is 24px, and the difference between a heading and a row is
 * carried by weight and space rather than by size.
 *
 * 13px base rather than MUI's 16px. At 16 a settlement table needs scrolling
 * on a laptop, and scrolling is where a discrepancy hides.
 */
export const SIZES = {
  page: 24,
  section: 17,
  body: 13,
  label: 12,
  small: 11,
} as const;
