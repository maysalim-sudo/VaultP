/**
 * When a recurring rule fires.
 *
 * Occurrences are always derived from the anchor date, never by repeatedly
 * advancing a stored "next due" value. Advancing a stored date accumulates drift:
 * a monthly subscription anchored on the 31st would step to the 30th in April and
 * then stay there forever. Deriving from the anchor keeps the 31st.
 */

import { type IsoDate, addDays, addMonths, compareDates, parseDate } from '../time/date.js';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Intermittent tools (CapCut, Topaz, Adobe) are paused, not deleted, so their
 *  spending history survives for year-on-year comparison. */
export type RuleState = 'active' | 'paused' | 'ended';

export interface RecurrenceSpec {
  readonly frequency: Frequency;
  /** Every N periods. 1 = every month, 3 = quarterly. */
  readonly intervalN: number;
  readonly anchorDate: IsoDate;
}

export class InvalidRecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceError';
  }
}

function assertValid(spec: RecurrenceSpec): void {
  if (!Number.isInteger(spec.intervalN) || spec.intervalN < 1) {
    throw new InvalidRecurrenceError(
      `Interval must be a positive whole number, got ${spec.intervalN}.`,
    );
  }
  parseDate(spec.anchorDate);
}

/** The nth occurrence counting from the anchor, n = 0 being the anchor itself. */
export function occurrenceAt(spec: RecurrenceSpec, n: number): IsoDate {
  assertValid(spec);
  const step = spec.intervalN * n;
  switch (spec.frequency) {
    case 'daily':
      return addDays(spec.anchorDate, step);
    case 'weekly':
      return addDays(spec.anchorDate, step * 7);
    case 'monthly':
      return addMonths(spec.anchorDate, step);
    case 'yearly':
      return addMonths(spec.anchorDate, step * 12);
  }
}

/** Roughly how many periods separate two dates; used only to skip ahead cheaply. */
function approximatePeriods(spec: RecurrenceSpec, from: IsoDate, to: IsoDate): number {
  const a = parseDate(from);
  const b = parseDate(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  const days = Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
  switch (spec.frequency) {
    case 'daily':
      return Math.floor(days / spec.intervalN);
    case 'weekly':
      return Math.floor(days / (7 * spec.intervalN));
    case 'monthly':
      return Math.floor(months / spec.intervalN);
    case 'yearly':
      return Math.floor(months / (12 * spec.intervalN));
  }
}

/** First occurrence on or after `date`. */
export function nextOccurrenceOnOrAfter(spec: RecurrenceSpec, date: IsoDate): IsoDate {
  assertValid(spec);
  if (compareDates(spec.anchorDate, date) >= 0) return spec.anchorDate;

  // Jump close, then step — exact, and avoids iterating thousands of days.
  let n = Math.max(0, approximatePeriods(spec, spec.anchorDate, date) - 1);
  let candidate = occurrenceAt(spec, n);
  while (compareDates(candidate, date) < 0) {
    n += 1;
    candidate = occurrenceAt(spec, n);
  }
  return candidate;
}

export const OCCURRENCE_CAP = 2000;

/**
 * Every occurrence in [from, to], inclusive.
 *
 * Capped so a daily rule queried over a decade cannot hang the UI thread; the cap
 * is far above any real range the app asks for.
 */
export function occurrencesBetween(
  spec: RecurrenceSpec,
  from: IsoDate,
  to: IsoDate,
  cap: number = OCCURRENCE_CAP,
): IsoDate[] {
  assertValid(spec);
  if (compareDates(from, to) > 0) return [];

  const result: IsoDate[] = [];
  let n = Math.max(0, approximatePeriods(spec, spec.anchorDate, from) - 1);
  let candidate = occurrenceAt(spec, n);

  while (compareDates(candidate, from) < 0) {
    n += 1;
    candidate = occurrenceAt(spec, n);
  }
  while (compareDates(candidate, to) <= 0 && result.length < cap) {
    result.push(candidate);
    n += 1;
    candidate = occurrenceAt(spec, n);
  }
  return result;
}
