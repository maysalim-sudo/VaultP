/**
 * Deciding what is worth interrupting someone for.
 *
 * This works out *what* to notify and *when*; the platform layer only schedules
 * what it is given. That split keeps the judgement — which is the part that can be
 * wrong — testable, and lets the desktop reuse it.
 *
 * The bar for a notification is deliberately high. An app that pings about
 * everything gets its notifications switched off, and then the one that mattered
 * never arrives. So: things with a deadline and a consequence, nothing else.
 */

import type { SqlDatabase } from './db/adapter.js';
import { type AllowanceConfig, forecastAllowance } from './expenses/allowance.js';
import { isAllowanceConfigured } from './settings.js';
import type { DocumentRepository } from './documents/repository.js';
import { type NoteRepository, noteHeadline } from './notes/repository.js';
import { dueOccurrences, upcomingCharges } from './expenses/scheduler.js';
import type { ExpenseRepository } from './expenses/repository.js';
import { toDecimalString } from './money/money.js';
import { type IsoDate, addDays, compareDates } from './time/date.js';

export type NotificationKind =
  | 'rule_due'
  | 'allowance_low'
  | 'unsettled'
  | 'document_expiring'
  | 'note_due';

export interface PlannedNotification {
  /**
   * Stable across runs: rescheduling replaces an entry rather than adding a
   * duplicate, so opening the app twice in a morning does not double every alert.
   */
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** Local date the notification should fire. */
  readonly date: IsoDate;
}

export interface NotificationOptions {
  /** How far ahead to schedule. Beyond this the data is too likely to change. */
  readonly horizonDays?: number;
  /** Warn when the allowance is projected to run out within this many days. */
  readonly allowanceWarningDays?: number;
  /** Remind about a charge this many days before it is due. */
  readonly leadDays?: number;
}

export const DEFAULT_HORIZON_DAYS = 45;
export const DEFAULT_ALLOWANCE_WARNING_DAYS = 45;
export const DEFAULT_LEAD_DAYS = 1;

export function planNotifications(
  repo: ExpenseRepository,
  db: SqlDatabase,
  allowanceConfig: AllowanceConfig,
  asOf: IsoDate,
  options: NotificationOptions = {},
  documents?: DocumentRepository,
  notes?: NoteRepository,
): PlannedNotification[] {
  const horizon = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const leadDays = options.leadDays ?? DEFAULT_LEAD_DAYS;
  const warningDays = options.allowanceWarningDays ?? DEFAULT_ALLOWANCE_WARNING_DAYS;

  const planned: PlannedNotification[] = [];

  // ---------------------------------------------------------- charges due
  //
  // Only remind-only rules. An auto-logged charge appears by itself, so telling
  // someone about it is noise: there is nothing for them to do.
  for (const upcoming of upcomingCharges(repo, asOf, horizon)) {
    if (upcoming.rule.autoLog) continue;

    const notifyOn = addDays(upcoming.date, -leadDays);
    // Never schedule into the past; a reminder for yesterday helps nobody.
    const date = compareDates(notifyOn, asOf) < 0 ? asOf : notifyOn;

    planned.push({
      id: `rule:${upcoming.rule.id}:${upcoming.date}`,
      kind: 'rule_due',
      title: `${upcoming.rule.name} is due`,
      body:
        `${toDecimalString(upcoming.rule.amount)} ${upcoming.rule.amount.currency}` +
        `${upcoming.date === date ? ' today' : ` on ${upcoming.date}`}.`,
      date,
    });
  }

  // Anything already overdue and still unlogged is worth one nudge today.
  for (const due of dueOccurrences(repo, asOf)) {
    if (due.alreadyLogged || due.rule.autoLog) continue;
    planned.push({
      id: `rule:${due.rule.id}:${due.date}`,
      kind: 'rule_due',
      title: `${due.rule.name} was due`,
      body: `${toDecimalString(due.rule.amount)} ${due.rule.amount.currency} on ${due.date}, not logged yet.`,
      date: asOf,
    });
  }

  // ------------------------------------------------------------- allowance
  //
  // The one alert with a hard consequence: past this date foreign cards decline
  // and subscriptions lapse, which is worth knowing well before it happens.
  if (isAllowanceConfigured(allowanceConfig)) {
    const allowance = forecastAllowance(db, allowanceConfig, asOf);

    if (allowance.exhaustionDate) {
      const warnFrom = addDays(allowance.exhaustionDate, -warningDays);
      const date = compareDates(warnFrom, asOf) < 0 ? asOf : warnFrom;

      planned.push({
        id: `allowance:${allowance.period.label}:${allowance.exhaustionDate}`,
        kind: 'allowance_low',
        title: 'Foreign currency allowance running out',
        body:
          `On this pace it is used up by ${allowance.exhaustionDate}. ` +
          `${toDecimalString(allowance.remaining)} ${allowance.remaining.currency} left.`,
        date,
      });
    }
  }

  // ------------------------------------------------------------- documents
  //
  // Each document carries its own lead time, so the warning arrives when there is
  // still time to act: months for a passport, days for a card. Renewal is the
  // thing people discover too late, which is exactly what a notification is for.
  if (documents) {
    for (const document of documents.expiringSoon(asOf)) {
      if (!document.expiryDate) continue;

      const warnFrom = addDays(document.expiryDate, -document.reminderLeadDays);
      const date = compareDates(warnFrom, asOf) < 0 ? asOf : warnFrom;
      const expired = compareDates(document.expiryDate, asOf) < 0;

      planned.push({
        id: `document:${document.id}:${document.expiryDate}`,
        kind: 'document_expiring',
        title: expired
          ? `${document.title} has expired`
          : `${document.title} expires soon`,
        body: expired
          ? `It expired on ${document.expiryDate}.`
          : `Expires ${document.expiryDate}. Renewing usually takes longer than you think.`,
        date,
      });
    }
  }

  // ----------------------------------------------------------------- notes
  //
  // Only notes that asked to be notified. A due date on its own is something the
  // user wants to see in a list, not be interrupted by — that distinction is the
  // whole reason the two are separate switches.
  if (notes) {
    for (const note of notes.notifiable()) {
      if (!note.dueOn) continue;

      const date = compareDates(note.dueOn, asOf) < 0 ? asOf : note.dueOn;
      const overdue = compareDates(note.dueOn, asOf) < 0;
      // The note's own title if it has one, else its first line: a notification
      // quoting a whole checklist would say nothing at a glance.
      const summary = noteHeadline(note);

      planned.push({
        id: `note:${note.id}:${note.dueOn}`,
        kind: 'note_due',
        title: overdue ? 'Still to do' : 'Due today',
        body: summary,
        date,
      });
    }
  }

  // Deduplicate by id, keeping the earliest date: an overdue nudge should win
  // over a scheduled reminder for the same occurrence.
  const byId = new Map<string, PlannedNotification>();
  for (const notification of planned) {
    const existing = byId.get(notification.id);
    if (!existing || compareDates(notification.date, existing.date) < 0) {
      byId.set(notification.id, notification);
    }
  }

  return [...byId.values()].sort(
    (a, b) => compareDates(a.date, b.date) || (a.id < b.id ? -1 : 1),
  );
}
