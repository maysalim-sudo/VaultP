/**
 * Money: integer minor units plus a currency code. Never a float.
 *
 * A JS number holds integers exactly up to 2^53-1. In millimes that is roughly
 * 9 trillion dinars, so `number` is safe here and avoids bigint friction across
 * SQLite, JSON, and React Native bridges.
 */

import {
  type CurrencyCode,
  exponentOf,
  getCurrency,
  minorUnitsPerMajor,
} from './currency.js';

export interface Money {
  /** Amount in the currency's minor unit: millimes for TND, cents for USD. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} with ${b} directly; convert first.`);
    this.name = 'CurrencyMismatchError';
  }
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new MoneyParseError(
      `amountMinor must be an integer number of minor units, got ${amountMinor}. ` +
        `A fractional value here means a float leaked into the money path.`,
    );
  }
  getCurrency(currency); // validate, throws on unknown
  return { amountMinor, currency: currency.toUpperCase() };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/** Round half away from zero: 2.5 -> 3, -2.5 -> -3. Symmetric for debits and credits. */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Parse user or CSV input into minor units.
 *
 * Accepts an optional sign, digit grouping via spaces or apostrophes, and a '.'
 * or ',' decimal separator. Excess precision is rejected rather than silently
 * rounded: "45.7512" in TND is a typo or a unit mix-up, not an amount.
 *
 * Comma is a decimal separator, never a thousands separator. It cannot be both
 * without ambiguity ("1,500" would be either 1.5 or 1500), and in the fr/ar
 * conventions used here the decimal reading is the correct one.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money {
  const exponent = exponentOf(currency);
  const raw = input.trim();
  if (raw === '') throw new MoneyParseError('Empty amount.');

  const match = /^([+-]?)([\d\s']*)(?:[.,](\d*))?$/.exec(raw);
  if (!match) throw new MoneyParseError(`Not a valid amount: "${input}"`);

  const [, sign = '', wholePart = '', fracPart] = match;
  const whole = wholePart.replace(/[\s']/g, '');
  const frac = fracPart ?? '';

  if (whole === '' && frac === '') {
    throw new MoneyParseError(`Not a valid amount: "${input}"`);
  }
  if (!/^\d*$/.test(whole)) {
    throw new MoneyParseError(`Not a valid amount: "${input}"`);
  }
  if (frac.length > exponent) {
    throw new MoneyParseError(
      `${currency} has ${exponent} decimal place(s); "${input}" has ${frac.length}.`,
    );
  }

  const padded = frac.padEnd(exponent, '0');
  const digits = `${whole === '' ? '0' : whole}${padded}`;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) {
    throw new MoneyParseError(`Amount out of safe range: "${input}"`);
  }
  return money(sign === '-' ? -value : value, currency);
}

/** Plain decimal string, no symbol: 68400 TND -> "68.400". For CSV and JSON. */
export function toDecimalString(m: Money): string {
  const exponent = exponentOf(m.currency);
  const negative = m.amountMinor < 0;
  const digits = Math.abs(m.amountMinor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const frac = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}

/** Localised display string, e.g. "68,400 DT" or "$20.00". For the UI only. */
export function formatMoney(m: Money, locale = 'en'): string {
  const exponent = exponentOf(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(m.amountMinor / minorUnitsPerMajor(m.currency));
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency));
}

export function negate(m: Money): Money {
  return money(-m.amountMinor, m.currency);
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0;
}

export function compare(a: Money, b: Money): number {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return Math.sign(a.amountMinor - b.amountMinor);
}

/** Multiply by a plain factor (a split, a percentage, a quantity). */
export function multiply(m: Money, factor: number): Money {
  return money(roundHalfAwayFromZero(m.amountMinor * factor), m.currency);
}

/**
 * Convert using an explicit rate expressed in MAJOR units:
 * `rate` = how many units of `to` one unit of `from` buys.
 *
 * The exponent shift is what makes this correct across TND (3) and USD (2);
 * a naive implementation that ignores it is wrong by a factor of ten.
 */
export function convert(m: Money, to: CurrencyCode, rate: number): Money {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyParseError(`Exchange rate must be a positive finite number, got ${rate}.`);
  }
  const shift = 10 ** (exponentOf(to) - exponentOf(m.currency));
  return money(roundHalfAwayFromZero(m.amountMinor * rate * shift), to);
}

/**
 * Derive the effective rate actually paid, from the two amounts.
 *
 * This is the primary path for foreign subscriptions: the vendor charges USD, the
 * bank debits TND including its spread and fees, and the honest rate is the one
 * implied by those two numbers — not a market rate looked up online.
 *
 * Returns major-units-of-`charged` per one major unit of `billed`.
 */
export function deriveRate(billed: Money, charged: Money): number {
  if (billed.amountMinor === 0) {
    throw new MoneyParseError('Cannot derive a rate from a zero billed amount.');
  }
  const shift = 10 ** (exponentOf(billed.currency) - exponentOf(charged.currency));
  return (charged.amountMinor / billed.amountMinor) * shift;
}
