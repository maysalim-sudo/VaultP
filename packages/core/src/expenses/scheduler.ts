/**
 * Turning recurring rules into actual expenses.
 *
 * The hard part is not knowing when a rule fires — that is `recurrence.ts` — but
 * making sure an occurrence is logged exactly once when two devices may both be
 * running the check, offline, on the same morning.
 *
 * The fix is a deterministic id. Both devices compute the same id for the same
 * rule on the same date, so if both log it the two events merge into one row
 * instead of producing duplicate charges. No coordination, no leader election, no
 * "which device is allowed to auto-log" setting.
 */

import type { IsoDate } from '../time/date.js';
import { addDays, compareDates } from '../time/date.js';
import type { Expense, ExpenseRepository, RecurringRule } from './repository.js';
import { occurrencesBetween } from './recurrence.js';

/** Stable across devices and reruns: the same occurrence always has this id. */
export function autoLogId(ruleId: string, date: IsoDate): string {
  return `auto:${ruleId}:${date}`;
}

export interface DueOccurrence {
  readonly rule: RecurringRule;
  readonly date: IsoDate;
  readonly alreadyLogged: boolean;
}

export interface SchedulerOptions {
  /**
   * How far back to look for occurrences that were never logged.
   *
   * Bounded because an app opened after months away should catch up on recent
   * misses, not silently create a year of back-dated charges the user cannot
   * remember checking.
   */
  readonly lookbackDays?: number;
}

export const DEFAULT_LOOKBACK_DAYS = 90;

/** Occurrences on or before `asOf` that fall inside the lookback window. */
export function dueOccurrences(
  repo: ExpenseRepository,
  asOf: IsoDate,
  options: SchedulerOptions = {},
): DueOccurrence[] {
  const lookback = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const windowStart = addDays(asOf, -lookback);
  const due: DueOccurrence[] = [];

  for (const rule of repo.listRules('active')) {
    // Three floors, and the latest wins:
    //   windowStart   catching up after the app was closed a while
    //   anchorDate    the rule does not fire before its own start
    //   createdOn     a rule created today must not invent history that predates
    //                 it. Adding "rent, monthly, the 1st" on the 7th should not
    //                 silently produce a charge for the 1st — that expense was
    //                 either already logged by hand or never happened.
    let from = windowStart;
    if (compareDates(rule.anchorDate, from) > 0) from = rule.anchorDate;
    if (rule.createdOn && compareDates(rule.createdOn, from) > 0) from = rule.createdOn;

    for (const date of occurrencesBetween(rule, from, asOf)) {
      due.push({
        rule,
        date,
        alreadyLogged: repo.getExpense(autoLogId(rule.id, date)) !== undefined,
      });
    }
  }

  return due.sort((a, b) => compareDates(a.date, b.date));
}

/**
 * Log every due occurrence of an auto-logging rule.
 *
 * Safe to call on every app launch: occurrences already logged are skipped, and a
 * race between two devices resolves into one row because the ids match.
 */
export function runAutoLog(
  repo: ExpenseRepository,
  asOf: IsoDate,
  options: SchedulerOptions = {},
): Expense[] {
  const created: Expense[] = [];

  for (const occurrence of dueOccurrences(repo, asOf, options)) {
    if (occurrence.alreadyLogged || !occurrence.rule.autoLog) continue;

    created.push(
      repo.addExpense({
        id: autoLogId(occurrence.rule.id, occurrence.date),
        occurredOn: occurrence.date,
        amount: occurrence.rule.amount,
        source: 'recurring',
        recurringRuleId: occurrence.rule.id,
        merchant: occurrence.rule.name,
        ...(occurrence.rule.categoryId ? { categoryId: occurrence.rule.categoryId } : {}),
      }),
    );
  }

  return created;
}

/** Due occurrences of remind-only rules that have not been logged yet. */
export function pendingReminders(
  repo: ExpenseRepository,
  asOf: IsoDate,
  options: SchedulerOptions = {},
): DueOccurrence[] {
  return dueOccurrences(repo, asOf, options).filter(
    (occurrence) => !occurrence.alreadyLogged && !occurrence.rule.autoLog,
  );
}

export interface UpcomingCharge {
  readonly rule: RecurringRule;
  readonly date: IsoDate;
}

/** What is going to be charged in the next `horizonDays`. Feeds the dashboard. */
export function upcomingCharges(
  repo: ExpenseRepository,
  asOf: IsoDate,
  horizonDays = 30,
): UpcomingCharge[] {
  const from = addDays(asOf, 1);
  const to = addDays(asOf, horizonDays);
  const upcoming: UpcomingCharge[] = [];

  for (const rule of repo.listRules('active')) {
    for (const date of occurrencesBetween(rule, from, to)) {
      upcoming.push({ rule, date });
    }
  }

  return upcoming.sort((a, b) => compareDates(a.date, b.date));
}

export interface PriceChange {
  readonly rule: RecurringRule;
  /** Positive when the price went up. */
  readonly differenceMinor: number;
  readonly ratio: number;
}

/**
 * Subscriptions whose price changed since the last recorded amount.
 *
 * Worth surfacing because a few dinars a month on a service you forgot you had is
 * exactly the kind of charge that never gets noticed on a statement.
 */
export function detectPriceChanges(repo: ExpenseRepository): PriceChange[] {
  const changes: PriceChange[] = [];

  for (const rule of repo.listRules()) {
    const previous = rule.lastSeenAmount;
    if (!previous || previous.amountMinor === 0) continue;
    if (previous.amountMinor === rule.amount.amountMinor) continue;

    changes.push({
      rule,
      differenceMinor: rule.amount.amountMinor - previous.amountMinor,
      ratio: rule.amount.amountMinor / previous.amountMinor,
    });
  }

  return changes.sort((a, b) => Math.abs(b.differenceMinor) - Math.abs(a.differenceMinor));
}
