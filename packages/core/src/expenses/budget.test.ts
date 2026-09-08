import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { expensesToCsv, escapeCsv } from '../export/csv.js';
import { parseAmount, toDecimalString } from '../money/money.js';
import { budgetForMonth, monthSummary, monthTotal, monthlyTotals } from './budget.js';
import { forecastMonth } from './forecast.js';
import { ExpenseRepository } from './repository.js';

const tnd = (value: string) => parseAmount(value, 'TND');
const usd = (value: string) => parseAmount(value, 'USD');

function newRepo() {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: 'dev_phone' });
  return { repo: new ExpenseRepository(store), db, store };
}

describe('monthly totals', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
    ctx.repo.addCategory({ id: 'food', name: 'Food' });
    ctx.repo.addExpense({ occurredOn: '2026-09-01', amount: tnd('4.500'), categoryId: 'food' });
    ctx.repo.addExpense({ occurredOn: '2026-09-15', amount: tnd('12.250'), categoryId: 'food' });
    ctx.repo.addExpense({ occurredOn: '2026-08-20', amount: tnd('100.000'), categoryId: 'food' });
  });

  it('sums only the requested month', () => {
    expect(toDecimalString(monthTotal(ctx.db, '2026-09').total)).toBe('16.750');
    expect(toDecimalString(monthTotal(ctx.db, '2026-08').total)).toBe('100.000');
  });

  it('counts rows whose base value is unknown instead of treating them as zero', () => {
    // A USD charge with no prior rate: no base value can be known.
    ctx.repo.addExpense({ occurredOn: '2026-09-20', amount: usd('20.00') });

    const total = monthTotal(ctx.db, '2026-09');

    expect(toDecimalString(total.total)).toBe('16.750');
    expect(total.unvaluedCount).toBe(1);
    expect(total.transactionCount).toBe(3);
  });

  it('flags totals that include an estimate', () => {
    ctx.repo.addExpense({
      occurredOn: '2026-09-05',
      amount: usd('20.00'),
      charged: tnd('71.250'),
    });
    ctx.repo.addExpense({ occurredOn: '2026-09-20', amount: usd('20.00') });

    const total = monthTotal(ctx.db, '2026-09');
    expect(total.estimatedCount).toBe(1);
    expect(toDecimalString(total.total)).toBe('159.250');
  });

  it('walks a range of months', () => {
    const series = monthlyTotals(ctx.db, '2026-08', '2026-10');
    expect(series.map((s) => `${s.month}:${toDecimalString(s.spend.total)}`)).toEqual([
      '2026-08:100.000',
      '2026-09:16.750',
      '2026-10:0.000',
    ]);
  });
});

describe('budgets', () => {
  it('reports remaining against a monthly limit', () => {
    const ctx = newRepo();
    ctx.repo.addCategory({ id: 'food', name: 'Food', monthlyLimit: tnd('400.000') });
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('120.000'), categoryId: 'food' });

    const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');

    expect(toDecimalString(budget!.remaining!)).toBe('280.000');
    expect(budget!.ratioUsed).toBeCloseTo(0.3, 6);
    expect(budget!.overspent).toBe(false);
  });

  it('marks a category overspent', () => {
    const ctx = newRepo();
    ctx.repo.addCategory({ id: 'food', name: 'Food', monthlyLimit: tnd('100.000') });
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('150.000'), categoryId: 'food' });

    const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');
    expect(budget!.overspent).toBe(true);
    expect(toDecimalString(budget!.remaining!)).toBe('-50.000');
  });

  it('leaves a category without a limit untracked but still counted', () => {
    const ctx = newRepo();
    ctx.repo.addCategory({ id: 'misc', name: 'Misc' });
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('30.000'), categoryId: 'misc' });

    const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');
    expect(budget!.limit).toBeNull();
    expect(budget!.remaining).toBeNull();
    expect(toDecimalString(budget!.spend.total)).toBe('30.000');
  });

  describe('rollover', () => {
    it('carries unspent budget forward', () => {
      const ctx = newRepo();
      ctx.repo.addCategory({
        id: 'food',
        name: 'Food',
        monthlyLimit: tnd('100.000'),
        rollover: true,
      });
      // July: spent 60 of 100, so 40 carries.
      ctx.repo.addExpense({ occurredOn: '2026-07-10', amount: tnd('60.000'), categoryId: 'food' });
      // August: spent 80 of 140, so 60 carries.
      ctx.repo.addExpense({ occurredOn: '2026-08-10', amount: tnd('80.000'), categoryId: 'food' });

      const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');

      expect(toDecimalString(budget!.carriedIn)).toBe('60.000');
      expect(toDecimalString(budget!.available!)).toBe('160.000');
    });

    it('does not carry a deficit forward as debt', () => {
      const ctx = newRepo();
      ctx.repo.addCategory({
        id: 'food',
        name: 'Food',
        monthlyLimit: tnd('100.000'),
        rollover: true,
      });
      // Blew the budget in August; September should still start clean.
      ctx.repo.addExpense({ occurredOn: '2026-08-10', amount: tnd('300.000'), categoryId: 'food' });

      const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');

      expect(toDecimalString(budget!.carriedIn)).toBe('0.000');
      expect(toDecimalString(budget!.available!)).toBe('100.000');
    });

    it('ignores rollover when the category has it switched off', () => {
      const ctx = newRepo();
      ctx.repo.addCategory({ id: 'food', name: 'Food', monthlyLimit: tnd('100.000') });
      ctx.repo.addExpense({ occurredOn: '2026-08-10', amount: tnd('10.000'), categoryId: 'food' });

      const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09');
      expect(toDecimalString(budget!.carriedIn)).toBe('0.000');
    });

    it('bounds how far back it reconstructs', () => {
      const ctx = newRepo();
      ctx.repo.addCategory({
        id: 'food',
        name: 'Food',
        monthlyLimit: tnd('100.000'),
        rollover: true,
      });
      ctx.repo.addExpense({ occurredOn: '2020-01-10', amount: tnd('1.000'), categoryId: 'food' });

      const [budget] = budgetForMonth(ctx.repo, ctx.db, '2026-09', {
        maxRolloverMonths: 3,
      });

      // Three months of untouched budget, not six years of it.
      expect(toDecimalString(budget!.carriedIn)).toBe('300.000');
    });
  });

  it('separates uncategorised spending in the summary', () => {
    const ctx = newRepo();
    ctx.repo.addCategory({ id: 'food', name: 'Food' });
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('10.000'), categoryId: 'food' });
    ctx.repo.addExpense({ occurredOn: '2026-09-06', amount: tnd('5.000') });

    const summary = monthSummary(ctx.repo, ctx.db, '2026-09');

    expect(toDecimalString(summary.spend.total)).toBe('15.000');
    expect(toDecimalString(summary.uncategorised.total)).toBe('5.000');
  });
});

describe('month-end forecast', () => {
  it('separates committed subscriptions from projected everyday spend', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('800.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-25',
    });
    // 10 days elapsed, 100.000 of variable spend: 10/day.
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('100.000') });

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-10');

    expect(forecast.daysElapsed).toBe(10);
    expect(forecast.daysRemaining).toBe(20);
    expect(toDecimalString(forecast.committed)).toBe('800.000');
    expect(toDecimalString(forecast.variable)).toBe('200.000');
    expect(toDecimalString(forecast.projectedTotal)).toBe('1100.000');
  });

  it('does not double-count a subscription already charged this month', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_rent',
      name: 'Rent',
      amount: tnd('800.000'),
      frequency: 'monthly',
      anchorDate: '2026-09-01',
    });
    ctx.repo.addExpense({
      occurredOn: '2026-09-01',
      amount: tnd('800.000'),
      recurringRuleId: 'r_rent',
    });

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-10');

    expect(toDecimalString(forecast.committed)).toBe('0.000');
    // And rule-generated spend is excluded from the variable trend.
    expect(toDecimalString(forecast.variable)).toBe('0.000');
  });

  it('flags the projection as unreliable early in the month', () => {
    const ctx = newRepo();
    ctx.repo.addExpense({ occurredOn: '2026-09-02', amount: tnd('50.000') });

    const early = forecastMonth(ctx.repo, ctx.db, '2026-09-02');
    expect(early.variableUnreliable).toBe(true);
    expect(early.daysWithSpending).toBe(1);
  });

  it('judges reliability by days with spending, not days elapsed', () => {
    const ctx = newRepo();
    // A month of back-dated expenses entered in one sitting. Twenty days have
    // passed, but there is exactly one day of evidence, and the naive daily
    // average would project a wildly inflated month.
    for (const amount of ['300.000', '20.000', '14.000', '5.000']) {
      ctx.repo.addExpense({ occurredOn: '2026-09-20', amount: tnd(amount) });
    }

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-20');

    expect(forecast.daysWithSpending).toBe(1);
    expect(forecast.variableUnreliable).toBe(true);
  });

  it('stops hedging once spending is spread across enough days', () => {
    const ctx = newRepo();
    for (const day of ['01', '03', '05', '08', '11', '15', '19']) {
      ctx.repo.addExpense({ occurredOn: `2026-09-${day}`, amount: tnd('10.000') });
    }

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-20');

    expect(forecast.daysWithSpending).toBe(7);
    expect(forecast.variableUnreliable).toBe(false);
  });

  it('reports the daily average the projection is built on', () => {
    const ctx = newRepo();
    // 100.000 over 10 elapsed days.
    ctx.repo.addExpense({ occurredOn: '2026-09-05', amount: tnd('100.000') });

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-10');

    expect(toDecimalString(forecast.dailyAverage)).toBe('10.000');
  });

  it('reports rules it could not value rather than guessing', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_topaz',
      name: 'Topaz',
      amount: usd('99.00'),
      frequency: 'monthly',
      anchorDate: '2026-09-20',
    });

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-10');

    expect(forecast.rulesWithoutRate).toEqual(['r_topaz']);
    expect(toDecimalString(forecast.committed)).toBe('0.000');
  });

  it('values a foreign subscription from a past real charge', () => {
    const ctx = newRepo();
    ctx.repo.addRule({
      id: 'r_claude',
      name: 'Claude',
      amount: usd('20.00'),
      frequency: 'monthly',
      anchorDate: '2026-09-20',
    });
    ctx.repo.addExpense({
      occurredOn: '2026-08-20',
      amount: usd('20.00'),
      charged: tnd('71.250'),
      recurringRuleId: 'r_claude',
    });

    const forecast = forecastMonth(ctx.repo, ctx.db, '2026-09-10');
    expect(toDecimalString(forecast.committed)).toBe('71.250');
  });
});

describe('CSV export', () => {
  it('writes both currencies and marks estimates', () => {
    const ctx = newRepo();
    ctx.repo.addCategory({ id: 'subs', name: 'Subscriptions' });
    ctx.repo.addExpense({
      occurredOn: '2026-09-07',
      amount: usd('20.00'),
      charged: tnd('71.250'),
      categoryId: 'subs',
      merchant: 'Claude',
    });

    const csv = expensesToCsv(ctx.repo.listExpenses(), {
      baseCurrency: 'TND',
      categories: ctx.repo.listCategories(),
    });
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('amount_base');
    expect(row).toContain('20.00');
    expect(row).toContain('71.250');
    expect(row).toContain('Subscriptions');
    expect(row).toContain(',no,');
  });

  it('leaves the base column blank rather than zero when unknown', () => {
    const ctx = newRepo();
    ctx.repo.addExpense({ occurredOn: '2026-09-07', amount: usd('20.00') });

    const csv = expensesToCsv(ctx.repo.listExpenses(), { baseCurrency: 'TND' });
    const row = csv.split('\r\n')[1]!;

    // A zero here would silently understate any total built from this column.
    expect(row).toContain('2026-09-07,20.00,USD,,TND,');
  });

  it('escapes quotes, commas and newlines', () => {
    expect(escapeCsv('plain')).toBe('plain');
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsv(null)).toBe('');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // A merchant name beginning with = would otherwise execute on open.
    expect(escapeCsv('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsv('+1234')).toBe("'+1234");
  });
});
