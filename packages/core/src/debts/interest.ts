/**
 * Interest accrual.
 *
 * The architecture note said to define the convention once, precisely, because
 * ambiguity here produces a number that disagrees with what the other person
 * believes they owe. This file is that definition.
 *
 * THE CONVENTION
 *
 *   Rate      is per accrual period, not annualised. 0.02 monthly means 2% a month.
 *   Elapsed   time is fractional, never rounded up to a whole period: half a month
 *             accrues half a period's interest. Rounding up would silently favour
 *             the lender.
 *   Daily     periods count exact days.
 *   Monthly   periods count whole calendar months plus a fraction of the part
 *             month, measured against that month's own length. February is a
 *             short month and is treated as one.
 *   Yearly    is twelve monthly periods.
 *   Simple    interest accrues on outstanding principal only; accrued interest
 *             never itself earns interest.
 *   Compound  interest is added to the balance at the end of each segment, so it
 *             does earn interest afterwards.
 *   Rounding  happens once, at the end, on the final figure. Rounding each step
 *             would accumulate drift over a long loan.
 *   Payments  reduce principal from the day they are made; interest already
 *             accrued before that day is unaffected.
 */

import { type IsoDate, compareDates, daysBetween, daysInMonth, parseDate } from '../time/date.js';

export type InterestMethod = 'none' | 'simple' | 'compound';
export type AccrualPeriod = 'daily' | 'monthly' | 'yearly';

export interface InterestTerms {
  readonly method: InterestMethod;
  /** Fraction per period. 0.05 monthly is 5% a month. */
  readonly rate: number;
  readonly period: AccrualPeriod;
}

export const NO_INTEREST: InterestTerms = { method: 'none', rate: 0, period: 'monthly' };

export class InvalidInterestTermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInterestTermsError';
  }
}

export function assertValidTerms(terms: InterestTerms): void {
  if (terms.method === 'none') return;
  if (!Number.isFinite(terms.rate) || terms.rate < 0) {
    throw new InvalidInterestTermsError(
      `Interest rate must be zero or positive, got ${terms.rate}.`,
    );
  }
  if (terms.rate > 1) {
    // 100% per period is almost certainly a percentage entered as a whole number.
    throw new InvalidInterestTermsError(
      `Interest rate ${terms.rate} is above 100% per period. Rates are fractions: ` +
        `use 0.05 for 5%, not 5.`,
    );
  }
}

/**
 * Fractional months between two dates.
 *
 * Whole calendar months, plus the leftover days as a fraction of the month they
 * fall in. The 15th of January to the 15th of February is exactly one month even
 * though it is 31 days, which is what someone reading the ledger expects.
 */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  if (compareDates(from, to) >= 0) return 0;

  const start = parseDate(from);
  const end = parseDate(to);

  let months = (end.year - start.year) * 12 + (end.month - start.month);
  let dayDelta = end.day - start.day;

  if (dayDelta < 0) {
    months -= 1;
    // Days remaining, measured against the month the leftover sits in.
    const previousMonth = end.month === 1 ? 12 : end.month - 1;
    const previousYear = end.month === 1 ? end.year - 1 : end.year;
    dayDelta += daysInMonth(previousYear, previousMonth);
    return months + dayDelta / daysInMonth(previousYear, previousMonth);
  }

  return months + dayDelta / daysInMonth(end.year, end.month);
}

/** Elapsed accrual periods, fractional. */
export function periodsBetween(
  from: IsoDate,
  to: IsoDate,
  period: AccrualPeriod,
): number {
  if (compareDates(from, to) >= 0) return 0;
  switch (period) {
    case 'daily':
      return daysBetween(from, to);
    case 'monthly':
      return monthsBetween(from, to);
    case 'yearly':
      return monthsBetween(from, to) / 12;
  }
}

/**
 * Interest accrued on a constant principal over one span.
 *
 * Returns an unrounded value: callers accumulate across segments and round once.
 */
export function accrueSimple(
  principal: number,
  terms: InterestTerms,
  from: IsoDate,
  to: IsoDate,
): number {
  if (terms.method === 'none' || principal <= 0) return 0;
  return principal * terms.rate * periodsBetween(from, to, terms.period);
}

/** Balance after compounding a constant principal over one span. */
export function compoundOver(
  principal: number,
  terms: InterestTerms,
  from: IsoDate,
  to: IsoDate,
): number {
  if (terms.method === 'none' || principal <= 0) return principal;
  return principal * (1 + terms.rate) ** periodsBetween(from, to, terms.period);
}

export interface PrincipalChange {
  readonly date: IsoDate;
  /** Negative for a repayment. */
  readonly deltaMinor: number;
}

export interface AccrualResult {
  /** Principal still outstanding, ignoring interest. */
  readonly principalMinor: number;
  /** Interest accrued and unpaid, rounded once at the end. */
  readonly interestMinor: number;
  readonly totalMinor: number;
}

/**
 * Walk a loan's timeline and accrue interest segment by segment.
 *
 * Splitting at every principal change is what makes a partial repayment actually
 * reduce the interest that follows it. Charging interest on the original amount
 * regardless of payments is a common shortcut and produces numbers the other
 * person will dispute.
 */
export function accrueOverTimeline(
  openedOn: IsoDate,
  principalMinor: number,
  changes: readonly PrincipalChange[],
  terms: InterestTerms,
  asOf: IsoDate,
): AccrualResult {
  assertValidTerms(terms);

  const relevant = [...changes]
    .filter((change) => compareDates(change.date, asOf) <= 0)
    .sort((a, b) => compareDates(a.date, b.date));

  if (terms.method === 'none') {
    const principal =
      principalMinor + relevant.reduce((sum, change) => sum + change.deltaMinor, 0);
    return {
      principalMinor: principal,
      interestMinor: 0,
      totalMinor: principal,
    };
  }

  let cursor = openedOn;
  let principal = principalMinor;
  let interest = 0;
  // Compound tracks one balance; simple keeps principal and interest apart.
  let balance = principalMinor;

  for (const change of relevant) {
    if (compareDates(change.date, cursor) > 0) {
      if (terms.method === 'compound') {
        balance = compoundOver(balance, terms, cursor, change.date);
      } else {
        interest += accrueSimple(principal, terms, cursor, change.date);
      }
      cursor = change.date;
    }
    principal += change.deltaMinor;
    balance += change.deltaMinor;
  }

  if (compareDates(cursor, asOf) < 0) {
    if (terms.method === 'compound') {
      balance = compoundOver(balance, terms, cursor, asOf);
    } else {
      interest += accrueSimple(principal, terms, cursor, asOf);
    }
  }

  if (terms.method === 'compound') {
    const total = Math.round(balance);
    return {
      principalMinor: principal,
      interestMinor: total - principal,
      totalMinor: total,
    };
  }

  const roundedInterest = Math.round(interest);
  return {
    principalMinor: principal,
    interestMinor: roundedInterest,
    totalMinor: principal + roundedInterest,
  };
}
