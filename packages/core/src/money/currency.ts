/**
 * Currency metadata.
 *
 * The base currency of this vault is TND, which has THREE decimal places
 * (1 dinar = 1000 millimes). Most money code in the wild assumes two and
 * multiplies by 100. Doing that here divides every dinar amount by ten, and the
 * bug is invisible until a total is wrong.
 *
 * So: the exponent is always looked up, never assumed. There is deliberately no
 * default fallback — an unknown currency throws rather than guessing 2.
 */

export type CurrencyCode = string;

export interface Currency {
  /** ISO 4217 alphabetic code. */
  readonly code: CurrencyCode;
  /** ISO 4217 exponent: decimal places, i.e. minor units = 10 ** exponent. */
  readonly exponent: number;
  readonly name: string;
}

const CURRENCIES: Readonly<Record<string, Currency>> = {
  TND: { code: 'TND', exponent: 3, name: 'Tunisian Dinar' },
  USD: { code: 'USD', exponent: 2, name: 'US Dollar' },
  EUR: { code: 'EUR', exponent: 2, name: 'Euro' },
  GBP: { code: 'GBP', exponent: 2, name: 'Pound Sterling' },
  CHF: { code: 'CHF', exponent: 2, name: 'Swiss Franc' },
  CAD: { code: 'CAD', exponent: 2, name: 'Canadian Dollar' },
  AED: { code: 'AED', exponent: 2, name: 'UAE Dirham' },
  SAR: { code: 'SAR', exponent: 2, name: 'Saudi Riyal' },
  MAD: { code: 'MAD', exponent: 2, name: 'Moroccan Dirham' },
  DZD: { code: 'DZD', exponent: 2, name: 'Algerian Dinar' },
  LYD: { code: 'LYD', exponent: 3, name: 'Libyan Dinar' },
  KWD: { code: 'KWD', exponent: 3, name: 'Kuwaiti Dinar' },
  BHD: { code: 'BHD', exponent: 3, name: 'Bahraini Dinar' },
  JOD: { code: 'JOD', exponent: 3, name: 'Jordanian Dinar' },
  JPY: { code: 'JPY', exponent: 0, name: 'Japanese Yen' },
  TRY: { code: 'TRY', exponent: 2, name: 'Turkish Lira' },
  EGP: { code: 'EGP', exponent: 2, name: 'Egyptian Pound' },
};

export class UnknownCurrencyError extends Error {
  constructor(code: string) {
    super(
      `Unknown currency "${code}". Add it to the currency table with its correct ` +
        `ISO 4217 exponent; guessing 2 decimals would silently corrupt amounts.`,
    );
    this.name = 'UnknownCurrencyError';
  }
}

export function getCurrency(code: CurrencyCode): Currency {
  const currency = CURRENCIES[code.toUpperCase()];
  if (!currency) throw new UnknownCurrencyError(code);
  return currency;
}

export function isKnownCurrency(code: CurrencyCode): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code.toUpperCase());
}

/** Decimal places for this currency. TND is 3, JPY is 0. */
export function exponentOf(code: CurrencyCode): number {
  return getCurrency(code).exponent;
}

/** Minor units per major unit: 1000 for TND, 100 for USD, 1 for JPY. */
export function minorUnitsPerMajor(code: CurrencyCode): number {
  return 10 ** exponentOf(code);
}

export function listCurrencies(): Currency[] {
  return Object.values(CURRENCIES).sort((a, b) => a.code.localeCompare(b.code));
}

/** The vault's base currency. Every report converts to this. */
export const BASE_CURRENCY: CurrencyCode = 'TND';
