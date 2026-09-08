import { describe, expect, it } from 'vitest';
import { BASE_CURRENCY, exponentOf, minorUnitsPerMajor } from './currency.js';
import {
  add,
  convert,
  deriveRate,
  formatMoney,
  money,
  multiply,
  parseAmount,
  subtract,
  sum,
  toDecimalString,
} from './money.js';

/**
 * These tests exist mainly to catch the three-decimal trap. A suite that only
 * covers USD and EUR passes happily while every dinar amount is off by 10x.
 */

describe('currency exponents', () => {
  it('gives TND three decimal places', () => {
    expect(exponentOf('TND')).toBe(3);
    expect(minorUnitsPerMajor('TND')).toBe(1000);
  });

  it('gives USD two and JPY zero', () => {
    expect(minorUnitsPerMajor('USD')).toBe(100);
    expect(minorUnitsPerMajor('JPY')).toBe(1);
  });

  it('refuses to guess an exponent for an unknown currency', () => {
    expect(() => exponentOf('XYZ')).toThrow(/Unknown currency/);
  });

  it('uses TND as the vault base', () => {
    expect(BASE_CURRENCY).toBe('TND');
  });
});

describe('parseAmount', () => {
  it('parses TND to millimes, not centimes', () => {
    expect(parseAmount('45.500', 'TND').amountMinor).toBe(45500);
    expect(parseAmount('1', 'TND').amountMinor).toBe(1000);
  });

  it('pads short fractions to the full exponent', () => {
    // "68.4" dinars is 68400 millimes, not 684.
    expect(parseAmount('68.4', 'TND').amountMinor).toBe(68400);
    expect(parseAmount('68.40', 'TND').amountMinor).toBe(68400);
  });

  it('parses USD to cents', () => {
    expect(parseAmount('20.00', 'USD').amountMinor).toBe(2000);
    expect(parseAmount('20', 'USD').amountMinor).toBe(2000);
  });

  it('accepts a comma as decimal separator and spaces as grouping', () => {
    expect(parseAmount('1 234,750', 'TND').amountMinor).toBe(1234750);
  });

  it('handles negatives and bare fractions', () => {
    expect(parseAmount('-12.250', 'TND').amountMinor).toBe(-12250);
    expect(parseAmount('.5', 'TND').amountMinor).toBe(500);
  });

  it('rejects more precision than the currency has', () => {
    expect(() => parseAmount('45.7512', 'TND')).toThrow(/3 decimal place/);
    expect(() => parseAmount('20.005', 'USD')).toThrow(/2 decimal place/);
  });

  it('rejects junk', () => {
    expect(() => parseAmount('', 'TND')).toThrow();
    expect(() => parseAmount('abc', 'TND')).toThrow();
  });
});

describe('formatting', () => {
  it('round-trips through a decimal string', () => {
    for (const input of ['0.001', '45.500', '1234.750', '-12.250']) {
      const parsed = parseAmount(input, 'TND');
      expect(toDecimalString(parsed)).toBe(input.replace(/^(-?)0*(\d)/, '$1$2'));
    }
  });

  it('keeps three decimals for TND when displayed', () => {
    expect(formatMoney(money(68400, 'TND'), 'en')).toMatch(/68\.400/);
  });

  it('keeps two for USD', () => {
    expect(formatMoney(money(2000, 'USD'), 'en-US')).toBe('$20.00');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts within a currency', () => {
    expect(add(money(45500, 'TND'), money(1500, 'TND')).amountMinor).toBe(47000);
    expect(subtract(money(45500, 'TND'), money(500, 'TND')).amountMinor).toBe(45000);
  });

  it('sums a list', () => {
    const items = ['12.500', '3.750', '0.250'].map((s) => parseAmount(s, 'TND'));
    expect(toDecimalString(sum(items, 'TND'))).toBe('16.500');
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(1000, 'TND'), money(1000, 'USD'))).toThrow(/Cannot combine/);
  });

  it('rounds multiplication half away from zero', () => {
    expect(multiply(money(101, 'TND'), 0.5).amountMinor).toBe(51);
    expect(multiply(money(-101, 'TND'), 0.5).amountMinor).toBe(-51);
  });

  it('never produces fractional minor units', () => {
    const third = multiply(parseAmount('10.000', 'TND'), 1 / 3);
    expect(Number.isInteger(third.amountMinor)).toBe(true);
    expect(toDecimalString(third)).toBe('3.333');
  });
});

describe('conversion across differing exponents', () => {
  it('converts USD to TND with the exponent shift applied', () => {
    // $20.00 at 3.42 TND/USD = 68.400 TND = 68400 millimes.
    const converted = convert(money(2000, 'USD'), 'TND', 3.42);
    expect(converted.amountMinor).toBe(68400);
    expect(toDecimalString(converted)).toBe('68.400');
  });

  it('converts TND back to USD', () => {
    const converted = convert(money(68400, 'TND'), 'USD', 1 / 3.42);
    expect(converted.amountMinor).toBe(2000);
  });

  it('rejects a nonsense rate', () => {
    expect(() => convert(money(2000, 'USD'), 'TND', 0)).toThrow(/positive finite/);
  });
});

describe('deriveRate — the foreign subscription path', () => {
  it('derives the effective rate the bank actually charged', () => {
    // Claude Pro billed at $20.00; the card statement shows 71.250 TND.
    const billed = parseAmount('20.00', 'USD');
    const charged = parseAmount('71.250', 'TND');
    expect(deriveRate(billed, charged)).toBeCloseTo(3.5625, 6);
  });

  it('round-trips: derived rate reproduces the charged amount', () => {
    const billed = parseAmount('20.00', 'USD');
    const charged = parseAmount('71.250', 'TND');
    const rate = deriveRate(billed, charged);
    expect(convert(billed, 'TND', rate).amountMinor).toBe(charged.amountMinor);
  });

  it('captures the bank spread as a difference from a market rate', () => {
    const billed = parseAmount('20.00', 'USD');
    const atMarket = convert(billed, 'TND', 3.42);
    const actuallyCharged = parseAmount('71.250', 'TND');
    const spread = subtract(actuallyCharged, atMarket);
    expect(toDecimalString(spread)).toBe('2.850');
  });

  it('refuses a zero billed amount', () => {
    expect(() => deriveRate(money(0, 'USD'), money(1000, 'TND'))).toThrow();
  });
});
