/**
 * Calendar dates as `YYYY-MM-DD` strings.
 *
 * Expenses happen on a *day*, not at an instant: a coffee bought at 23:50 belongs
 * to that day whatever the timezone, and must not slide into the next one because
 * the phone was set to UTC. Storing a plain date string avoids the entire class of
 * timezone bugs that come from putting a Date in a database and reading it back
 * somewhere else.
 *
 * Arithmetic goes through UTC internally, purely as a calendar calculator.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`Not a valid YYYY-MM-DD date: "${value}"`);
    this.name = 'InvalidDateError';
  }
}

export function parseDate(value: IsoDate): DateParts {
  const match = ISO_DATE.exec(value);
  if (!match) throw new InvalidDateError(value);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidDateError(value);
  }
  return { year, month, day };
}

/**
 * Is this a complete, real date?
 *
 * Non-throwing on purpose. A field being typed into passes through "2", "202",
 * "2028-0" — all invalid, none of them an error worth raising. Anything reacting
 * to input as it is typed needs to ask rather than catch.
 */
export function isValidDate(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatDate(parts: DateParts): IsoDate {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseDate(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/**
 * Add months, clamping to the end of the target month.
 *
 * A subscription anchored on the 31st bills on the 30th in April and the 28th in
 * February; overflowing into the next month instead would drift the billing date
 * forward a little further every year.
 */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseDate(value);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return formatDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseDate(from);
  const b = parseDate(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** First day of the month containing `value`. */
export function startOfMonth(value: IsoDate): IsoDate {
  const { year, month } = parseDate(value);
  return formatDate({ year, month, day: 1 });
}

export function endOfMonth(value: IsoDate): IsoDate {
  const { year, month } = parseDate(value);
  return formatDate({ year, month, day: daysInMonth(year, month) });
}

/** `YYYY-MM`, the key used for monthly grouping. */
export function monthKey(value: IsoDate): string {
  return value.slice(0, 7);
}

export function todayIn(now: Date = new Date()): IsoDate {
  return formatDate({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}
