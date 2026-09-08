/**
 * Amount entry state.
 *
 * Held as typed text rather than a number so a half-finished "4," is
 * representable and the display never reformats under the user's fingers while
 * they are still typing. The exponent is a parameter because TND takes three
 * decimals and USD two, and the same keypad serves both.
 */

export interface Draft {
  readonly whole: string;
  readonly fraction: string | null;
}

export const EMPTY_DRAFT: Draft = { whole: '', fraction: null };

export function pressDigit(draft: Draft, digit: string, exponent: number): Draft {
  if (draft.fraction === null) {
    // A leading zero would allow "007", which reads oddly on review.
    const whole = draft.whole === '0' ? digit : draft.whole + digit;
    return { ...draft, whole: whole.slice(0, 9) };
  }
  if (draft.fraction.length >= exponent) return draft;
  return { ...draft, fraction: draft.fraction + digit };
}

export function pressDecimal(draft: Draft, exponent: number): Draft {
  // A currency with no minor unit has nothing to type after the separator.
  if (exponent === 0 || draft.fraction !== null) return draft;
  return { whole: draft.whole === '' ? '0' : draft.whole, fraction: '' };
}

export function pressBackspace(draft: Draft): Draft {
  if (draft.fraction !== null) {
    if (draft.fraction.length > 0) return { ...draft, fraction: draft.fraction.slice(0, -1) };
    return { ...draft, fraction: null };
  }
  return { ...draft, whole: draft.whole.slice(0, -1) };
}

export function draftToMinor(draft: Draft, exponent: number): number {
  const whole = draft.whole === '' ? 0 : Number(draft.whole);
  const fraction = (draft.fraction ?? '').padEnd(exponent, '0');
  return whole * 10 ** exponent + (fraction === '' ? 0 : Number(fraction));
}

export function draftDisplay(draft: Draft): string {
  const whole = draft.whole === '' ? '0' : draft.whole;
  // The separator appears as soon as it is pressed, so the tap has visible effect.
  return draft.fraction === null ? whole : `${whole},${draft.fraction}`;
}

/** Seed the pad from an existing amount, for editing. */
export function draftFromMinor(minor: number, exponent: number): Draft {
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : '';
  return {
    whole: String(Number(whole)),
    // Trailing zeros are dropped so backspace behaves as though it had been typed.
    fraction: fraction === '' || /^0+$/.test(fraction) ? null : fraction.replace(/0+$/, ''),
  };
}

/**
 * Re-interpret a draft when the currency changes.
 *
 * Typing 20,00 as USD and switching to TND should stay twenty dinars, not become
 * two. Keeping the typed text and re-reading it under the new exponent preserves
 * what the user meant, and truncates only when the new currency has fewer
 * decimals than were typed.
 */
export function retypeForExponent(draft: Draft, exponent: number): Draft {
  if (draft.fraction === null) return draft;
  if (exponent === 0) return { whole: draft.whole, fraction: null };
  return { ...draft, fraction: draft.fraction.slice(0, exponent) };
}
