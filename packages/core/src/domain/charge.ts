/**
 * What a leg kept: the difference between what was sent and what arrived.
 *
 * Almost every movement in this ledger costs something. A Rise withdrawal of
 * $250.00 lands as $245.97 because the processor took its flat $4.03; the
 * award itself arrives $100.79 light because the platform charged for it. In
 * both cases the fee is not written down anywhere — it is the gap between two
 * numbers that *are* — and the person entering the leg has already typed both.
 *
 * So the form fills the charge in rather than asking twice. It is a fee like
 * any other (F5): a `transaction_fees` row in the **source** currency, which
 * is what `v_data_quality`'s reconcile check assumes when it computes
 * `to_amount = (from_amount − fees in from_currency) × rate`, and what the
 * importer already does for `network_fee` and `platform_charge`.
 *
 * **Why a function over strings, when §6 says `Money` does the arithmetic.**
 * A form holds what somebody typed, and the browser has no currency table to
 * turn that into `Money` with — scale lives in the database (§6). This is
 * therefore the one piece of money arithmetic that works on decimal strings,
 * and it is exact integer arithmetic on `bigint`, never a float: the two
 * strings are aligned to a common scale, subtracted as whole numbers, and
 * printed back. The same sum `Money.subtract` would do, with the scale taken
 * from the digits instead of from the table.
 *
 * It lives here, in the domain, for the reason §5a puts the password policy
 * here: the rule has one home, and the browser runs the same one.
 */

/** A positive decimal, which is all an amount field can hold (§7). */
const DECIMAL = /^(\d+)(?:\.(\d*))?$/;

interface Scaled {
  readonly minor: bigint;
  readonly scale: number;
}

function parse(text: string): Scaled | null {
  const match = DECIMAL.exec(text.trim());
  if (match === null) return null;

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  return {
    minor: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

/** Both figures at the finer of the two scales, so the subtraction is exact. */
function align(one: Scaled, other: Scaled): readonly [bigint, bigint, number] {
  const scale = Math.max(one.scale, other.scale);
  const lift = (value: Scaled): bigint =>
    value.minor * 10n ** BigInt(scale - value.scale);

  return [lift(one), lift(other), scale];
}

/** Half-up on positive integers, matching `Money`'s default rounding. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * What the received amount was worth on the sending side, at `scale`.
 *
 * The inverse of the multiplication `Money.multiplyByRate` does, rounded the
 * same way: a rate says how many of the destination unit one source unit
 * bought, so dividing by it takes the arrival back to the currency the fee was
 * charged in.
 */
function backThroughRate(
  received: Scaled,
  rate: Scaled,
  scale: number,
): bigint | null {
  if (rate.minor <= 0n) return null;

  /*
    The powers of ten go on whichever side keeps the exponent positive.

    A token amount carries more decimals than the dollars it came from — 8
    against 2 (§6) — so `rate.scale + scale - received.scale` is routinely
    negative, and `10n ** -6n` is a RangeError rather than a small number.
  */
  const shift = rate.scale + scale - received.scale;
  const lift = (power: number): bigint => 10n ** BigInt(Math.max(power, 0));

  return divideHalfUp(
    received.minor * lift(shift),
    rate.minor * lift(-shift),
  );
}

function format(minor: bigint, scale: number): string {
  const digits = minor.toString().padStart(scale + 1, '0');
  if (scale === 0) return digits;

  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * The charge a leg implies, or null when there is none to imply.
 *
 * With no rate, the two amounts are in the same currency and the charge is the
 * difference. With one, the arrival is taken back through the rate first —
 * §10's withdrawals are USD out and USDT in at 1.00000000, and the $4.03 Rise
 * kept is only visible once the two sides are in the same money.
 *
 * Null rather than `'0'` in every case where the answer would be a guess:
 *
 * - either amount still empty or half-typed, which is most of the time a form
 *   is on screen;
 * - a cross-currency leg whose rate nobody has recorded yet — the gap between
 *   753 USDT and ₹73,000 is a rate, not a fee, and §7 deliberately allows a
 *   rate to arrive after the amounts do;
 * - nothing kept, so there is no fee to record — a zero fee is a fact worth
 *   recording deliberately, not one to fill in for somebody;
 * - **more arrived than was sent**, which is not a negative fee. On a transfer
 *   it is usually dust left from an earlier hop joining this one (§7 flags the
 *   shape rather than forbidding it), and inventing a refund out of it would
 *   be worse than saying nothing.
 *
 * The answer is at the scale of the amount **sent**, because that is the
 * currency the fee was taken in.
 */
export function impliedCharge(
  sent: string,
  received: string,
  rate?: string | null,
): string | null {
  const from = parse(sent);
  const to = parse(received);

  if (from === null || to === null) return null;

  /*
    No rate *given* and a blank one are different answers.

    Omitting it says the two sides are the same money, so the difference is
    the whole story. Passing a string says a rate belongs here — and a string
    that is not a rate yet, because the field is empty or half-typed, means
    nothing can be said: subtracting dollars from tokens would produce a
    confident, wrong figure, which is the one outcome worth ruling out.
  */
  if (rate === undefined || rate === null) {
    const [sentMinor, receivedMinor, scale] = align(from, to);
    const kept = sentMinor - receivedMinor;

    return kept <= 0n ? null : format(kept, scale);
  }

  const applied = parse(rate);
  if (applied === null) return null;

  const worth = backThroughRate(to, applied, from.scale);
  if (worth === null) return null;

  const kept = from.minor - worth;

  return kept <= 0n ? null : format(kept, from.scale);
}
