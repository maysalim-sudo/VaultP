import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  isValidDate,
  parseDate,
} from '../time/date.js';
import {
  InvalidRecurrenceError,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
} from './recurrence.js';

describe('date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps to the end of a shorter month instead of overflowing', () => {
    // A subscription anchored on the 31st bills on the 30th in April.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('rejects impossible dates', () => {
    expect(() => parseDate('2026-02-30')).toThrow(/not a valid/i);
    expect(() => parseDate('2026-13-01')).toThrow(/not a valid/i);
    expect(() => parseDate('07/09/2026')).toThrow(/not a valid/i);
  });

  it('finds the end of a month', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('occurrences', () => {
  const monthly = { frequency: 'monthly', intervalN: 1, anchorDate: '2026-01-15' } as const;

  it('walks forward from the anchor', () => {
    expect(occurrenceAt(monthly, 0)).toBe('2026-01-15');
    expect(occurrenceAt(monthly, 1)).toBe('2026-02-15');
    expect(occurrenceAt(monthly, 12)).toBe('2027-01-15');
  });

  it('does not drift when the anchor is the 31st', () => {
    const spec = { frequency: 'monthly', intervalN: 1, anchorDate: '2026-01-31' } as const;
    // February clamps, but March returns to the 31st — a stored "next due" that
    // was advanced repeatedly would have stuck on the 28th forever.
    expect(occurrencesBetween(spec, '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('handles intervals greater than one', () => {
    const quarterly = { frequency: 'monthly', intervalN: 3, anchorDate: '2026-01-10' } as const;
    expect(occurrencesBetween(quarterly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-10',
      '2026-04-10',
      '2026-07-10',
      '2026-10-10',
    ]);
  });

  it('supports weekly, daily and yearly', () => {
    expect(
      occurrencesBetween(
        { frequency: 'weekly', intervalN: 2, anchorDate: '2026-01-01' },
        '2026-01-01',
        '2026-02-01',
      ),
    ).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);

    expect(
      occurrencesBetween(
        { frequency: 'daily', intervalN: 1, anchorDate: '2026-01-01' },
        '2026-01-01',
        '2026-01-04',
      ),
    ).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);

    expect(
      occurrencesBetween(
        { frequency: 'yearly', intervalN: 1, anchorDate: '2024-02-29' },
        '2024-01-01',
        '2027-01-01',
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });

  it('finds the next occurrence from a date far after the anchor', () => {
    expect(nextOccurrenceOnOrAfter(monthly, '2030-06-20')).toBe('2030-07-15');
    // On the day itself counts as due.
    expect(nextOccurrenceOnOrAfter(monthly, '2026-02-15')).toBe('2026-02-15');
    // Before the anchor, the anchor is next.
    expect(nextOccurrenceOnOrAfter(monthly, '2025-01-01')).toBe('2026-01-15');
  });

  it('returns nothing for an inverted range', () => {
    expect(occurrencesBetween(monthly, '2026-06-01', '2026-01-01')).toEqual([]);
  });

  it('caps runaway ranges rather than hanging', () => {
    const daily = { frequency: 'daily', intervalN: 1, anchorDate: '2000-01-01' } as const;
    expect(occurrencesBetween(daily, '2000-01-01', '2099-01-01', 50)).toHaveLength(50);
  });

  it('rejects a nonsense interval', () => {
    expect(() =>
      occurrenceAt({ frequency: 'monthly', intervalN: 0, anchorDate: '2026-01-01' }, 1),
    ).toThrow(InvalidRecurrenceError);
  });
});

describe('isValidDate', () => {
  it('accepts a complete real date', () => {
    expect(isValidDate('2026-09-07')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects a half-typed date without throwing', () => {
    // Every prefix a user passes through while typing a year.
    for (const partial of ['', '2', '20', '202', '2028', '2028-', '2028-0']) {
      expect(isValidDate(partial)).toBe(false);
    }
  });

  it('rejects dates that do not exist', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2025-02-29')).toBe(false);
  });

  it('rejects other formats', () => {
    expect(isValidDate('07/09/2026')).toBe(false);
    expect(isValidDate('2026-9-7')).toBe(false);
  });
});
