/**
 * Monthly budgets, with optional rollover.
 *
 * Two honesty rules run through this file:
 *
 *   1. Rows whose base-currency value is unknown are counted separately, never as
 *      zero. A total that quietly omits three foreign charges looks like good news
 *      and is the opposite.
 *   2. Rollover is recomputed from history rather than stored. A stored carry
 *      would need updating whenever a past expense is edited — which is exactly
 *      when the number matters — and two devices would disagree about it.
 */

import type { SqlDatabase } from '../db/adapter.js';
import { BASE_CURRENCY, type CurrencyCode } from '../money/currency.js';
import { type Money, money } from '../money/money.js';
import { addMonths, endOfMonth, monthKey, startOfMonth } from '../time/date.js';
import type { Category, ExpenseRepository } from './repository.js';

/** `YYYY-MM`. */
export type MonthKey = string;

export interface SpendTotals {
  readonly total: Money;
  readonly transactionCount: number;
  /** Included in `total`, but derived from a past rate rather than a statement. */
  readonly estimatedCount: number;
  /** Excluded from `total` entirely: no base-currency value is known. */
  readonly unvaluedCount: number;
}

export interface CategoryBudget {
  readonly category: Category;
  readonly month: MonthKey;
  readonly limit: Money | null;
  /** Unspent budget carried in from previous months. Zero unless rollover is on. */
  readonly carriedIn: Money;
  /** limit + carriedIn, or null when the category has no limit. */
  readonly available: Money | null;
  readonly spend: SpendTotals;
  readonly remaining: Money | null;
  /** Fraction of `available` consumed; null without a limit. */
  readonly ratioUsed: number | null;
  readonly overspent: boolean;
}

export interface BudgetOptions {
  /** How far back rollover is reconstructed. Bounds the work on a long history. */
  readonly maxRolloverMonths?: number;
  readonly baseCurrency?: CurrencyCode;
}

export const DEFAULT_MAX_ROLLOVER_MONTHS = 24;

interface SpendRow {
  category_id: string | null;
  total: number | null;
  n: number;
  estimated: number;
  unvalued: number;
}

function monthBounds(month: MonthKey): { start: string; end: string } {
  const first = `${month}-01`;
  return { start: startOfMonth(first), end: endOfMonth(first) };
}

function emptyTotals(currency: CurrencyCode): SpendTotals {
  return {
    total: money(0, currency),
    transactionCount: 0,
    estimatedCount: 0,
    unvaluedCount: 0,
  };
}

/**
 * Spend per category for one month.
 *
 * `SUM` ignores NULL, so an expense with no known base value would silently
 * vanish. It is counted in `unvaluedCount` instead, which the UI can surface as
 * "2 amounts not yet known".
 */
export function spendByCategory(
  db: SqlDatabase,
  month: MonthKey,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
): Map<string | null, SpendTotals> {
  const { start, end } = monthBounds(month);
  const rows = db.all<SpendRow>(
    `SELECT category_id,
            SUM(base_amount_minor)                                    AS total,
            COUNT(*)                                                  AS n,
            SUM(CASE WHEN fx_estimated = 1 THEN 1 ELSE 0 END)         AS estimated,
            SUM(CASE WHEN base_amount_minor IS NULL THEN 1 ELSE 0 END) AS unvalued
       FROM expense
      WHERE deleted_at IS NULL AND occurred_on >= ? AND occurred_on <= ?
      GROUP BY category_id`,
    [start, end],
  );

  const result = new Map<string | null, SpendTotals>();
  for (const row of rows) {
    result.set(row.category_id, {
      total: money(row.total ?? 0, baseCurrency),
      transactionCount: row.n,
      estimatedCount: row.estimated,
      unvaluedCount: row.unvalued,
    });
  }
  return result;
}

/** Whole-month totals across every category. */
export function monthTotal(
  db: SqlDatabase,
  month: MonthKey,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
): SpendTotals {
  let total = 0;
  let transactionCount = 0;
  let estimatedCount = 0;
  let unvaluedCount = 0;

  for (const totals of spendByCategory(db, month, baseCurrency).values()) {
    total += totals.total.amountMinor;
    transactionCount += totals.transactionCount;
    estimatedCount += totals.estimatedCount;
    unvaluedCount += totals.unvaluedCount;
  }

  return {
    total: money(total, baseCurrency),
    transactionCount,
    estimatedCount,
    unvaluedCount,
  };
}

/** Earliest month holding any expense, used as the floor for rollover. */
function earliestExpenseMonth(db: SqlDatabase): MonthKey | undefined {
  const row = db.get<{ first: string | null }>(
    'SELECT MIN(occurred_on) AS first FROM expense WHERE deleted_at IS NULL',
  );
  return row?.first ? monthKey(row.first) : undefined;
}

function shiftMonth(month: MonthKey, delta: number): MonthKey {
  return monthKey(addMonths(`${month}-01`, delta));
}

/**
 * Budget position for every category in one month.
 *
 * For a rollover category, unspent budget accumulates: the month's available
 * amount is its limit plus whatever survived earlier months. Overspending does not
 * carry forward as debt — a bad month starts the next one clean, which is what
 * makes the feature useful rather than punishing.
 */
export function budgetForMonth(
  repo: ExpenseRepository,
  db: SqlDatabase,
  month: MonthKey,
  options: BudgetOptions = {},
): CategoryBudget[] {
  const baseCurrency = options.baseCurrency ?? repo.baseCurrency;
  const maxMonths = options.maxRolloverMonths ?? DEFAULT_MAX_ROLLOVER_MONTHS;
  const categories = repo.listCategories();

  const floor = earliestExpenseMonth(db) ?? month;
  const windowStart = shiftMonth(month, -maxMonths);
  const firstMonth = floor > windowStart ? floor : windowStart;

  // One pass over the months, reused for every category.
  const months: MonthKey[] = [];
  for (let cursor = firstMonth; cursor <= month; cursor = shiftMonth(cursor, 1)) {
    months.push(cursor);
  }
  const spendByMonth = new Map(
    months.map((key) => [key, spendByCategory(db, key, baseCurrency)]),
  );

  return categories.map((category) => {
    const limit = category.monthlyLimit;
    let carry = 0;

    if (limit && category.rollover) {
      for (const past of months) {
        if (past === month) break;
        const spent = spendByMonth.get(past)?.get(category.id)?.total.amountMinor ?? 0;
        // Surplus accumulates; a deficit resets to zero rather than becoming debt.
        carry = Math.max(0, limit.amountMinor + carry - spent);
      }
    }

    const spend =
      spendByMonth.get(month)?.get(category.id) ?? emptyTotals(baseCurrency);
    const available = limit ? money(limit.amountMinor + carry, baseCurrency) : null;

    return {
      category,
      month,
      limit,
      carriedIn: money(carry, baseCurrency),
      available,
      spend,
      remaining: available
        ? money(available.amountMinor - spend.total.amountMinor, baseCurrency)
        : null,
      ratioUsed:
        available && available.amountMinor > 0
          ? spend.total.amountMinor / available.amountMinor
          : null,
      overspent: available !== null && spend.total.amountMinor > available.amountMinor,
    };
  });
}

export interface MonthSummary {
  readonly month: MonthKey;
  readonly spend: SpendTotals;
  readonly budgets: readonly CategoryBudget[];
  /** Spend on expenses with no category set. */
  readonly uncategorised: SpendTotals;
}

export function monthSummary(
  repo: ExpenseRepository,
  db: SqlDatabase,
  month: MonthKey,
  options: BudgetOptions = {},
): MonthSummary {
  const baseCurrency = options.baseCurrency ?? repo.baseCurrency;
  return {
    month,
    spend: monthTotal(db, month, baseCurrency),
    budgets: budgetForMonth(repo, db, month, options),
    uncategorised:
      spendByCategory(db, month, baseCurrency).get(null) ?? emptyTotals(baseCurrency),
  };
}

/** Total per month over a range, oldest first. For trends and charts. */
export function monthlyTotals(
  db: SqlDatabase,
  fromMonth: MonthKey,
  toMonth: MonthKey,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
): Array<{ month: MonthKey; spend: SpendTotals }> {
  const result: Array<{ month: MonthKey; spend: SpendTotals }> = [];
  for (let cursor = fromMonth; cursor <= toMonth; cursor = shiftMonth(cursor, 1)) {
    result.push({ month: cursor, spend: monthTotal(db, cursor, baseCurrency) });
  }
  return result;
}

export { shiftMonth };
export type { Money };
