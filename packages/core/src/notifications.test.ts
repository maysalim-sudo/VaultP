import { describe, expect, it } from 'vitest';
import { VaultStore } from './db/store.js';
import { openTestDatabase } from './db/testing/nodeSqlite.js';
import { DEFAULT_ALLOWANCE_CONFIG } from './expenses/allowance.js';
import { DocumentRepository } from './documents/repository.js';
import { ExpenseRepository } from './expenses/repository.js';
import { NoteRepository } from './notes/repository.js';
import { parseAmount } from './money/money.js';
import { planNotifications } from './notifications.js';

const tnd = (value: string) => parseAmount(value, 'TND');
const usd = (value: string) => parseAmount(value, 'USD');

function newRepo() {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: 'dev_phone' });
  return { repo: new ExpenseRepository(store), db, store };
}

function backdateRule(store: VaultStore, id: string, date: string): void {
  store.commit('recurring_rule', id, { created_at: `${date}T09:00:00.000Z` });
}

const ALLOWANCE = {
  ceilingMinor: tnd('300.000').amountMinor,
  currency: 'TND',
  yearStartMonth: 1,
};

describe('notification planning', () => {
  it('plans nothing for an empty vault', () => {
    const ctx = newRepo();
    expect(
      planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07'),
    ).toEqual([]);
  });

  it('reminds about a rule the day before it is due', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-20',
      autoLog: false,
    });

    const planned = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');

    expect(planned[0]).toMatchObject({
      kind: 'rule_due',
      date: '2026-09-19',
      title: 'Rent is due',
    });
    expect(planned[0]?.body).toContain('300.000 TND');

    // October's occurrence also falls inside the 45-day horizon, and gets its own
    // entry with its own id. Scheduling both is deliberate: the phone holds them
    // whether or not the app is opened again.
    expect(planned.map((n) => n.id)).toEqual([
      'rule:r_rent:2026-09-20',
      'rule:r_rent:2026-10-20',
    ]);
  });

  it('says nothing about a rule that logs itself', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-20',
      autoLog: true,
    });

    // Nothing for the user to do, so interrupting them would be pure noise.
    expect(
      planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07'),
    ).toEqual([]);
  });

  it('nudges today about a charge that is already overdue', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
      autoLog: false,
    });
    backdateRule(ctx.store, 'r_rent', '2026-09-01');

    const planned = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');
    const overdue = planned.find((n) => n.id === 'rule:r_rent:2026-09-01');

    expect(overdue).toMatchObject({ date: '2026-09-07', title: 'Rent was due' });
  });

  it('stops nudging once the charge is logged', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
      autoLog: false,
    });
    backdateRule(ctx.store, 'r_rent', '2026-09-01');
    ctx.repo.addExpense({
      id: 'auto:r_rent:2026-09-01',
      occurredOn: '2026-09-01',
      amount: tnd('300.000'),
      recurringRuleId: 'r_rent',
    });

    const planned = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');
    expect(planned.find((n) => n.id === 'rule:r_rent:2026-09-01')).toBeUndefined();
  });

  it('never schedules a reminder in the past', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_daily',
      name: 'Parking',
      amount: tnd('2.000'),
      frequency: 'daily',
      anchorDate: '2026-09-07',
      autoLog: false,
    });

    const planned = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');

    for (const notification of planned) {
      expect(notification.date >= '2026-09-07').toBe(true);
    }
  });

  it('gives one entry per occurrence, so reopening the app does not duplicate', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
      autoLog: false,
    });
    backdateRule(ctx.store, 'r_rent', '2026-09-01');

    const first = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');
    const second = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');

    expect(new Set(first.map((n) => n.id)).size).toBe(first.length);
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id));
  });

  it('warns before the foreign allowance runs out', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_claude',
      name: 'Claude',
      amount: usd('20.00'),
      frequency: 'monthly',
      anchorDate: '2026-01-15',
      autoLog: true,
    });
    ctx.repo.addExpense({
      occurredOn: '2026-01-15',
      amount: usd('20.00'),
      charged: tnd('71.250'),
      recurringRuleId: 'r_claude',
    });

    const planned = planNotifications(ctx.repo, ctx.db, ALLOWANCE, '2026-01-20');
    const warning = planned.find((n) => n.kind === 'allowance_low');

    expect(warning).toBeDefined();
    expect(warning?.title).toMatch(/allowance running out/i);
    expect(warning?.body).toContain('2026-05-15');
  });

  it('says nothing about an allowance that comfortably holds', () => {
    const ctx = newRepo();
    ctx.repo.addExpense({
      occurredOn: '2026-01-15',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });

    const roomy = { ...ALLOWANCE, ceilingMinor: tnd('50000.000').amountMinor };
    const planned = planNotifications(ctx.repo, ctx.db, roomy, '2026-01-20');

    expect(planned.filter((n) => n.kind === 'allowance_low')).toEqual([]);
  });

  it('says nothing about an allowance that is switched off', () => {
    const ctx = newRepo();
    ctx.repo.addExpense({
      occurredOn: '2026-01-15',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });

    expect(
      planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-01-20').filter(
        (n) => n.kind === 'allowance_low',
      ),
    ).toEqual([]);
  });

  it('returns entries in the order they will fire', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_late',
      name: 'Late',
      amount: tnd('10.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-28',
      autoLog: false,
    });
    ctx.repo.addRule({
      id: 'r_soon',
      name: 'Soon',
      amount: tnd('10.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-12',
      autoLog: false,
    });

    const planned = planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-09-07');
    const dates = planned.map((n) => n.date);

    expect([...dates].sort()).toEqual(dates);
  });

  it('does not schedule beyond the horizon', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_daily',
      name: 'Parking',
      amount: tnd('2.000'),
      frequency: 'daily',
      anchorDate: '2026-09-08',
      autoLog: false,
    });

    const planned = planNotifications(
      ctx.repo,
      ctx.db,
      DEFAULT_ALLOWANCE_CONFIG,
      '2026-09-07',
      { horizonDays: 5 },
    );

    expect(planned.length).toBeLessThanOrEqual(5);
  });
});

describe('document expiry notifications', () => {
  function withDocuments() {
    const ctx = newRepo();
    return { ...ctx, documents: new DocumentRepository(ctx.store) };
  }

  it('warns before a document expires, using its own lead time', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({
      id: 'doc_passport',
      title: 'Passport',
      expiryDate: '2027-01-01',
      reminderLeadDays: 180,
    });

    const planned = planNotifications(
      ctx.repo,
      ctx.db,
      DEFAULT_ALLOWANCE_CONFIG,
      '2026-08-01',
      {},
      ctx.documents,
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      kind: 'document_expiring',
      title: 'Passport expires soon',
      // Six months before 2027-01-01 is 2026-07-05, which has already passed, so
      // the warning fires today rather than at a date in the past.
      date: '2026-08-01',
    });
  });

  it('waits until the lead time is reached', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({
      title: 'Passport',
      expiryDate: '2027-01-01',
      reminderLeadDays: 180,
    });

    // A day before the window opens: still nothing.
    expect(
      planNotifications(
        ctx.repo,
        ctx.db,
        DEFAULT_ALLOWANCE_CONFIG,
        '2026-07-04',
        {},
        ctx.documents,
      ),
    ).toEqual([]);

    // The day it opens, scheduled for exactly that day.
    const onTheDay = planNotifications(
      ctx.repo,
      ctx.db,
      DEFAULT_ALLOWANCE_CONFIG,
      '2026-07-05',
      {},
      ctx.documents,
    );
    expect(onTheDay[0]?.date).toBe('2026-07-05');
  });

  it('stays quiet while the expiry is still far off', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({
      title: 'Passport',
      expiryDate: '2030-01-01',
      reminderLeadDays: 180,
    });

    expect(
      planNotifications(
        ctx.repo,
        ctx.db,
        DEFAULT_ALLOWANCE_CONFIG,
        '2026-08-01',
        {},
        ctx.documents,
      ),
    ).toEqual([]);
  });

  it('says so when a document has already expired', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({ title: 'Old card', expiryDate: '2026-01-01' });

    const planned = planNotifications(
      ctx.repo,
      ctx.db,
      DEFAULT_ALLOWANCE_CONFIG,
      '2026-08-01',
      {},
      ctx.documents,
    );

    expect(planned[0]).toMatchObject({
      title: 'Old card has expired',
      date: '2026-08-01',
    });
  });

  it('ignores documents with no expiry', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({ title: 'Diploma' });

    expect(
      planNotifications(
        ctx.repo,
        ctx.db,
        DEFAULT_ALLOWANCE_CONFIG,
        '2026-08-01',
        {},
        ctx.documents,
      ),
    ).toEqual([]);
  });

  it('plans nothing for documents when the repository is not supplied', () => {
    const ctx = withDocuments();
    ctx.documents.addDocument({ title: 'Passport', expiryDate: '2026-08-02' });

    expect(
      planNotifications(ctx.repo, ctx.db, DEFAULT_ALLOWANCE_CONFIG, '2026-08-01'),
    ).toEqual([]);
  });
});

describe('note reminders', () => {
  function withNotes() {
    const ctx = newRepo();
    return { ...ctx, notes: new NoteRepository(ctx.store) };
  }

  function plan(ctx: ReturnType<typeof withNotes>, asOf: string) {
    return planNotifications(
      ctx.repo,
      ctx.db,
      DEFAULT_ALLOWANCE_CONFIG,
      asOf,
      {},
      undefined,
      ctx.notes,
    );
  }

  it('notifies on the day for a note that asked to be', () => {
    const ctx = withNotes();
    ctx.notes.addNote({ body: 'Call the bank', dueOn: '2026-09-10', notify: true });

    const planned = plan(ctx, '2026-09-07');

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      kind: 'note_due',
      title: 'Due today',
      body: 'Call the bank',
      date: '2026-09-10',
    });
  });

  it('says nothing about a dated note that did not ask to be notified', () => {
    const ctx = withNotes();
    // A date to see in a list, not an interruption.
    ctx.notes.addNote({ body: 'Renew the lease', dueOn: '2026-09-10' });

    expect(plan(ctx, '2026-09-07')).toEqual([]);
  });

  it('says nothing about a note with no date', () => {
    const ctx = withNotes();
    ctx.notes.addNote({ body: 'Ideas for the trip', notify: true });

    expect(plan(ctx, '2026-09-07')).toEqual([]);
  });

  it('nudges today about something already overdue', () => {
    const ctx = withNotes();
    ctx.notes.addNote({ body: 'Pay the bill', dueOn: '2026-09-01', notify: true });

    expect(plan(ctx, '2026-09-07')[0]).toMatchObject({
      title: 'Still to do',
      date: '2026-09-07',
    });
  });

  it('stops once the note is ticked off', () => {
    const ctx = withNotes();
    const note = ctx.notes.addNote({
      body: 'Pay the bill',
      dueOn: '2026-09-01',
      notify: true,
    });
    ctx.notes.setDone(note.id, true);

    expect(plan(ctx, '2026-09-07')).toEqual([]);
  });

  it('shortens a long note rather than filling the notification with it', () => {
    const ctx = withNotes();
    ctx.notes.addNote({
      body: 'A'.repeat(200),
      dueOn: '2026-09-10',
      notify: true,
    });

    expect(plan(ctx, '2026-09-07')[0]?.body).toHaveLength(58);
  });
});
