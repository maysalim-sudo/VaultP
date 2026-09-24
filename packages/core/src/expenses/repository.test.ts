import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from '../db/store.js';
import { todayIn } from '../time/date.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { parseAmount, toDecimalString } from '../money/money.js';
import { ExpenseRepository, ExpenseValidationError } from './repository.js';
import {
  autoLogId,
  detectPriceChanges,
  pendingReminders,
  runAutoLog,
  upcomingCharges,
} from './scheduler.js';

const tnd = (value: string) => parseAmount(value, 'TND');
const usd = (value: string) => parseAmount(value, 'USD');

function newRepo(device = 'dev_phone') {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device });
  return { repo: new ExpenseRepository(store), store, db };
}

/**
 * Pretend a rule has existed since `date`.
 *
 * Rules record when they were created, and auto-log will not fabricate charges
 * from before that. To test catching up after the app has been closed for weeks,
 * the rule has to be older than the occurrences it should produce.
 */
function backdateRule(store: VaultStore, id: string, date: string): void {
  store.commit('recurring_rule', id, { created_at: `${date}T09:00:00.000Z` });
}

describe('categories', () => {
  it('creates and lists', () => {
    const { repo } = newRepo();
    repo.addCategory({ name: 'Food', monthlyLimit: tnd('400.000') });
    repo.addCategory({ name: 'Transport' });

    const categories = repo.listCategories();
    expect(categories.map((c) => c.name).sort()).toEqual(['Food', 'Transport']);
    expect(toDecimalString(categories.find((c) => c.name === 'Food')!.monthlyLimit!)).toBe(
      '400.000',
    );
  });

  it('archives rather than deletes, so old expenses keep a readable category', () => {
    const { repo } = newRepo();
    const food = repo.addCategory({ name: 'Food' });
    repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('4.500'), categoryId: food.id });

    repo.archiveCategory(food.id);

    expect(repo.listCategories()).toHaveLength(0);
    expect(repo.listCategories(true)).toHaveLength(1);
    // The expense still resolves its category name.
    expect(repo.getCategory(food.id)?.name).toBe('Food');
  });

  it('rejects a blank name', () => {
    const { repo } = newRepo();
    expect(() => repo.addCategory({ name: '   ' })).toThrow(ExpenseValidationError);
  });
});

describe('adding expenses', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
  });

  it('records a local expense with no conversion', () => {
    const expense = ctx.repo.addExpense({
      occurredOn: '2026-09-07',
      amount: tnd('4.500'),
      merchant: 'Cafe',
    });

    expect(toDecimalString(expense.amount)).toBe('4.500');
    expect(toDecimalString(expense.base!)).toBe('4.500');
    expect(expense.fxRate).toBe(1);
    expect(expense.baseEstimated).toBe(false);
  });

  it('records a foreign charge at what the bank actually debited', () => {
    const expense = ctx.repo.addExpense({
      occurredOn: '2026-09-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
      merchant: 'Claude',
    });

    expect(toDecimalString(expense.amount)).toBe('20.00');
    expect(toDecimalString(expense.base!)).toBe('71.250');
    expect(expense.baseEstimated).toBe(false);
    expect(expense.fxRate).toBeCloseTo(3.5625, 6);
  });

  it('estimates from the last real charge when the statement is not in yet', () => {
    ctx.repo.addExpense({
      occurredOn: '2026-08-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });

    const later = ctx.repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });

    expect(toDecimalString(later.base!)).toBe('71.250');
    // Flagged, so a total built on it can say it contains estimates.
    expect(later.baseEstimated).toBe(true);
  });

  it('records no base value at all for a currency never charged before', () => {
    const expense = ctx.repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });

    // Inventing a rate here would put a fabricated number into every total.
    expect(expense.base).toBeNull();
    expect(expense.baseEstimated).toBe(true);
  });

  it('replaces an estimate with the real figure once the statement arrives', () => {
    ctx.repo.addExpense({
      occurredOn: '2026-08-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });
    const estimated = ctx.repo.addExpense({
      occurredOn: '2026-09-07',
      amount: usd('20.00'),
    });
    expect(estimated.baseEstimated).toBe(true);

    const settled = ctx.repo.settleExpense(estimated.id, tnd('73.000'));

    expect(toDecimalString(settled.base!)).toBe('73.000');
    expect(settled.baseEstimated).toBe(false);
    expect(ctx.repo.listUnsettled()).toHaveLength(0);
  });

  it('does not use an estimated row as the basis for another estimate', () => {
    ctx.repo.addExpense({
      occurredOn: '2026-07-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });
    // An estimated row at a different implied rate.
    const estimated = ctx.repo.addExpense({ occurredOn: '2026-08-07', amount: usd('50.00') });
    expect(estimated.baseEstimated).toBe(true);

    const next = ctx.repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });

    // Still 3.5625 from the real charge, not compounded off a guess.
    expect(toDecimalString(next.base!)).toBe('71.250');
  });

  it('rejects a zero amount and a bad date', () => {
    expect(() =>
      ctx.repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('0') }),
    ).toThrow(ExpenseValidationError);
    expect(() =>
      ctx.repo.addExpense({ occurredOn: '07/09/2026', amount: tnd('4.500') }),
    ).toThrow(/not a valid/i);
  });

  it('rejects a debited amount that is not in the base currency', () => {
    expect(() =>
      ctx.repo.addExpense({
        occurredOn: '2026-09-07',
        amount: usd('20.00'),
        charged: usd('20.00'),
      }),
    ).toThrow(/must be in TND/);
  });
});

describe('querying', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
    const food = ctx.repo.addCategory({ name: 'Food', id: 'food' });
    ctx.repo.addExpense({ occurredOn: '2026-09-01', amount: tnd('4.500'), categoryId: food.id });
    ctx.repo.addExpense({ occurredOn: '2026-09-15', amount: tnd('12.000'), categoryId: food.id });
    ctx.repo.addExpense({ occurredOn: '2026-10-01', amount: tnd('30.000') });
  });

  it('filters by date range', () => {
    const september = ctx.repo.listExpenses({ from: '2026-09-01', to: '2026-09-30' });
    expect(september).toHaveLength(2);
  });

  it('filters by category', () => {
    expect(ctx.repo.listExpenses({ categoryId: 'food' })).toHaveLength(2);
  });

  it('returns newest first and paginates', () => {
    const all = ctx.repo.listExpenses();
    expect(all[0]?.occurredOn).toBe('2026-10-01');

    const page = ctx.repo.listExpenses({ limit: 2, offset: 1 });
    expect(page.map((e) => e.occurredOn)).toEqual(['2026-09-15', '2026-09-01']);
  });

  it('omits deleted expenses', () => {
    const [first] = ctx.repo.listExpenses();
    ctx.repo.deleteExpense(first!.id);
    expect(ctx.repo.listExpenses()).toHaveLength(2);
  });
});

describe('correcting an expense', () => {
  it('re-derives the base value when the amount changes', () => {
    const { repo } = newRepo();
    // The classic typo: 300 entered as 3000.
    const wrong = repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('3000.000') });

    const fixed = repo.updateExpense(wrong.id, { amount: tnd('300.000') });

    expect(toDecimalString(fixed.amount)).toBe('300.000');
    // Leaving the old base would give a row whose two figures disagree.
    expect(toDecimalString(fixed.base!)).toBe('300.000');
  });

  it('re-estimates a foreign amount rather than keeping the old conversion', () => {
    const { repo } = newRepo();
    repo.addExpense({
      occurredOn: '2026-08-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });
    const estimated = repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });
    expect(toDecimalString(estimated.base!)).toBe('71.250');

    const fixed = repo.updateExpense(estimated.id, { amount: usd('40.00') });

    expect(toDecimalString(fixed.base!)).toBe('142.500');
    expect(fixed.baseEstimated).toBe(true);
  });

  it('records the real debited amount, clearing the estimate flag', () => {
    const { repo } = newRepo();
    const expense = repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });
    expect(expense.base).toBeNull();

    const settled = repo.updateExpense(expense.id, { charged: tnd('73.000') });

    expect(toDecimalString(settled.base!)).toBe('73.000');
    expect(settled.baseEstimated).toBe(false);
    expect(settled.fxRate).toBeCloseTo(3.65, 6);
  });

  it('changes currency and value together', () => {
    const { repo } = newRepo();
    // Logged as local by mistake; it was actually a dollar subscription.
    const expense = repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('60.000') });

    const fixed = repo.updateExpense(expense.id, {
      amount: usd('20.00'),
      charged: tnd('60.000'),
    });

    expect(fixed.amount.currency).toBe('USD');
    expect(toDecimalString(fixed.base!)).toBe('60.000');
    expect(fixed.fxRate).toBeCloseTo(3, 6);
  });

  it('keeps every correction in the history', () => {
    const { repo, store } = newRepo();
    const expense = repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('3000.000') });
    repo.updateExpense(expense.id, { amount: tnd('300.000') });
    repo.deleteExpense(expense.id);

    const history = store.historyOf('expense', expense.id);
    expect(history.map((e) => e.op)).toEqual(['put', 'put', 'delete']);
    expect(history[0]?.fields.amount_minor).toBe(3_000_000);
  });

  it('clears a category when the correction is null', () => {
    const { repo } = newRepo();
    const category = repo.addCategory({ name: 'Groceries' });
    const expense = repo.addExpense({
      occurredOn: '2026-09-07',
      amount: tnd('10.000'),
      categoryId: category.id,
    });

    const fixed = repo.updateExpense(expense.id, { categoryId: null });

    expect(fixed.categoryId).toBeNull();
  });

  it('leaves a settled amount alone when only the merchant is corrected', () => {
    const { repo } = newRepo();
    // The debited figure is a fact off a statement. Fixing a typo in the shop
    // name must not turn it back into a guess.
    const expense = repo.addExpense({
      occurredOn: '2026-09-07',
      amount: usd('20.00'),
      charged: tnd('62.400'),
    });

    const fixed = repo.updateExpense(expense.id, { merchant: 'Steam' });

    expect(fixed.baseEstimated).toBe(false);
    expect(toDecimalString(fixed.base!)).toBe('62.400');
  });

  it('rejects a correction to zero', () => {
    const { repo } = newRepo();
    const expense = repo.addExpense({ occurredOn: '2026-09-07', amount: tnd('10.000') });
    expect(() => repo.updateExpense(expense.id, { amount: tnd('0') })).toThrow(
      ExpenseValidationError,
    );
  });
});

describe('recurring rules', () => {
  it('records a price change and keeps the previous amount', () => {
    const { repo } = newRepo();
    const rule = repo.addRule({
      name: 'Claude',
      amount: usd('20.00'),
      frequency: 'monthly',
      anchorDate: '2026-01-15',
    });

    repo.updateRuleAmount(rule.id, usd('25.00'));

    const changes = detectPriceChanges(repo);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.differenceMinor).toBe(500);
    expect(changes[0]?.ratio).toBeCloseTo(1.25, 6);
  });

  it('reports no change for a stable subscription', () => {
    const { repo } = newRepo();
    repo.addRule({
      name: 'Google',
      amount: usd('10.00'),
      frequency: 'monthly',
      anchorDate: '2026-01-01',
    });
    expect(detectPriceChanges(repo)).toHaveLength(0);
  });

  it('pauses and resumes without losing history', () => {
    const { repo } = newRepo();
    const rule = repo.addRule({
      name: 'Adobe',
      amount: usd('30.00'),
      frequency: 'monthly',
      anchorDate: '2026-01-10',
    });

    repo.setRuleState(rule.id, 'paused');
    expect(repo.listRules('active')).toHaveLength(0);
    expect(repo.getRule(rule.id)?.state).toBe('paused');

    repo.setRuleState(rule.id, 'active');
    expect(repo.listRules('active')).toHaveLength(1);
  });
});

describe('auto-logging', () => {
  it('catches up on every occurrence missed while the app was closed', () => {
    const { repo, store } = newRepo();
    repo.addRule({
      id: 'r_claude',
      name: 'Claude',
      amount: tnd('71.250'),
      frequency: 'monthly',
      anchorDate: '2026-07-15',
      autoLog: true,
    });
    backdateRule(store, 'r_claude', '2026-07-01');

    const created = runAutoLog(repo, '2026-09-20');

    expect(created.map((e) => e.occurredOn)).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ]);
    expect(created[0]?.source).toBe('recurring');
    expect(created[0]?.merchant).toBe('Claude');
  });

  it('is safe to run repeatedly', () => {
    const { repo, store } = newRepo();
    repo.addRule({
      id: 'r_claude',
      name: 'Claude',
      amount: tnd('71.250'),
      frequency: 'monthly',
      anchorDate: '2026-07-15',
      autoLog: true,
    });
    backdateRule(store, 'r_claude', '2026-07-01');

    runAutoLog(repo, '2026-09-20');
    const second = runAutoLog(repo, '2026-09-20');

    expect(second).toHaveLength(0);
    expect(repo.listExpenses()).toHaveLength(3);
  });

  it('produces one row when two devices both auto-log the same occurrence', () => {
    // The scenario the deterministic id exists for: both devices open offline on
    // the same morning, both decide the charge is due.
    const phone = newRepo('dev_phone');
    const desktop = newRepo('dev_desktop');

    for (const ctx of [phone, desktop]) {
      ctx.repo.addRule({
        id: 'r_claude',
        name: 'Claude',
        amount: tnd('71.250'),
        frequency: 'monthly',
        anchorDate: '2026-09-15',
        autoLog: true,
      });
      // Pin createdOn before the occurrence, or the "no back-fill" floor (which
      // uses the real clock for a rule's creation date) drops the charge once
      // today has moved past the hard-coded asOf below.
      backdateRule(ctx.store, 'r_claude', '2026-09-01');
      runAutoLog(ctx.repo, '2026-09-20');
    }

    // Later, they sync.
    desktop.store.ingest(phone.store.pendingUploads());
    phone.store.ingest(desktop.store.pendingUploads());

    for (const ctx of [phone, desktop]) {
      const logged = ctx.repo.listExpenses();
      expect(logged).toHaveLength(1);
      expect(logged[0]?.id).toBe(autoLogId('r_claude', '2026-09-15'));
      expect(toDecimalString(logged[0]!.amount)).toBe('71.250');
    }
  });

  it('leaves remind-only rules for the user to confirm', () => {
    const { repo, store } = newRepo();
    repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('800.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
      autoLog: false,
    });
    backdateRule(store, 'r_rent', '2026-09-01');

    expect(runAutoLog(repo, '2026-09-20')).toHaveLength(0);

    const reminders = pendingReminders(repo, '2026-09-20');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.rule.name).toBe('Rent');
  });

  it('does not invent history from before the rule was created', () => {
    const { repo } = newRepo();
    // Rent day is the 1st, but the rule is created on the 7th. The 1st either was
    // already logged by hand or never happened; either way the app must not
    // fabricate it.
    repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('300.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
      autoLog: true,
    });

    const created = runAutoLog(repo, '2026-09-07');

    expect(created).toHaveLength(0);
    expect(repo.listExpenses()).toHaveLength(0);
  });

  it('still logs occurrences that fall after the rule was created', () => {
    const { repo } = newRepo();
    repo.addRule({
      id: 'r_daily',
      name: 'Parking',
      amount: tnd('2.000'),
      frequency: 'daily',
      anchorDate: '2026-09-01',
      autoLog: true,
    });

    // Created today, so today's occurrence counts but the earlier ones do not.
    const today = todayIn();
    const created = runAutoLog(repo, today);
    expect(created.map((e) => e.occurredOn)).toEqual([today]);
  });

  it('does not back-fill beyond the lookback window', () => {
    const { repo, store } = newRepo();
    repo.addRule({
      id: 'r_old',
      name: 'Old subscription',
      amount: tnd('10.000'),
      frequency: 'monthly',
      anchorDate: '2020-01-01',
      autoLog: true,
    });
    backdateRule(store, 'r_old', '2020-01-01');

    // Five years of history would otherwise appear at once.
    const created = runAutoLog(repo, '2026-09-20', { lookbackDays: 90 });
    expect(created.length).toBeLessThanOrEqual(4);
  });

  it('ignores paused rules', () => {
    const { repo } = newRepo();
    const rule = repo.addRule({
      id: 'r_capcut',
      name: 'CapCut',
      amount: tnd('30.000'),
      frequency: 'monthly',
      anchorDate: '2026-08-01',
      autoLog: true,
    });
    repo.setRuleState(rule.id, 'paused');

    expect(runAutoLog(repo, '2026-09-20')).toHaveLength(0);
  });
});

describe('upcoming charges', () => {
  it('lists what is coming in the next month', () => {
    const { repo } = newRepo();
    repo.addRule({
      name: 'Claude',
      amount: usd('20.00'),
      frequency: 'monthly',
      anchorDate: '2026-09-15',
    });
    repo.addRule({
      name: 'Rent',
      amount: tnd('800.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
    });

    const upcoming = upcomingCharges(repo, '2026-09-07', 30);

    expect(upcoming.map((c) => `${c.date} ${c.rule.name}`)).toEqual([
      '2026-09-15 Claude',
      '2026-10-01 Rent',
    ]);
  });

  it('excludes today, which is already accounted for', () => {
    const { repo } = newRepo();
    repo.addRule({
      name: 'Daily',
      amount: tnd('1.000'),
      frequency: 'daily',
      anchorDate: '2026-09-07',
    });

    const upcoming = upcomingCharges(repo, '2026-09-07', 3);
    expect(upcoming.map((c) => c.date)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
  });
});
