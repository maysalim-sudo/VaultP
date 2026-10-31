/**
 * Amount entry, the way a card terminal does it.
 *
 * Digits fill in from the right, so 1 8 5 0 0 reads 18.500 and the decimals are
 * always there, as many as the currency has. There is no separator to press and
 * nothing half-typed to represent. The exponent is a parameter because the dinar
 * takes three decimals and the dollar two, and the same keypad serves both.
 *
 * The draft stays split into whole and fraction, not one number, so that an
 * untouched field (`EMPTY_DRAFT`) stays distinct from a typed zero: a debited
 * amount left blank means "not known yet", and that must not read as zero.
 */

export interface Draft {
  readonly whole: string;
  readonly fraction: string | null;
}

export const EMPTY_DRAFT: Draft = { whole: '', fraction: null };

/** 999,999,999.999: past any amount this app holds, within what a number keeps exactly. */
const MAX_MINOR = 999_999_999_999;

export function draftToMinor(draft: Draft, exponent: number): number {
  const whole = draft.whole === '' ? 0 : Number(draft.whole);
  const fraction = (draft.fraction ?? '').padEnd(exponent, '0').slice(0, exponent);
  return whole * 10 ** exponent + (fraction === '' ? 0 : Number(fraction));
}

/** Seed the pad from an existing amount, for editing. */
export function draftFromMinor(minor: number, exponent: number): Draft {
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  return {
    whole: String(Number(whole)),
    fraction: exponent > 0 ? digits.slice(digits.length - exponent) : null,
  };
}

/** A digit, or the "00" key, pushed in from the right. */
export function pressDigit(draft: Draft, digits: string, exponent: number): Draft {
  const next = draftToMinor(draft, exponent) * 10 ** digits.length + Number(digits);
  if (next > MAX_MINOR) return draft;
  return next === 0 ? EMPTY_DRAFT : draftFromMinor(next, exponent);
}

export function pressBackspace(draft: Draft, exponent: number): Draft {
  const next = Math.floor(draftToMinor(draft, exponent) / 10);
  return next === 0 ? EMPTY_DRAFT : draftFromMinor(next, exponent);
}

/** The amount as it reads on the display: 1,240.500, every decimal shown. */
export function draftDisplay(draft: Draft, exponent: number): string {
  const { whole, fraction } = draftFromMinor(draftToMinor(draft, exponent), exponent);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === null ? grouped : `${grouped}.${fraction}`;
}

/**
 * Re-read a draft when the currency changes.
 *
 * Twenty dollars switched to dinars stays twenty, not two. Only what the new
 * currency has no room for is dropped.
 */
export function retypeForExponent(draft: Draft, exponent: number): Draft {
  if (draft.whole === '' && draft.fraction === null) return draft;
  if (exponent === 0) return { whole: draft.whole, fraction: null };
  return { whole: draft.whole, fraction: (draft.fraction ?? '').slice(0, exponent).padEnd(exponent, '0') };
}
