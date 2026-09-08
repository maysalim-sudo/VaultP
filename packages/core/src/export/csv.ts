/**
 * CSV export.
 *
 * The point of this file is that your data can leave. If the app is abandoned, the
 * phone dies, or you simply want a spreadsheet at tax time, one function produces
 * something every tool on earth can read.
 *
 * Amounts are written as plain decimal strings in their own currency, with the
 * base-currency value alongside. Never a float, and never a bare number whose
 * currency the reader has to guess.
 */

import type { CurrencyCode } from '../money/currency.js';
import { toDecimalString } from '../money/money.js';
import type { Category, Expense } from '../expenses/repository.js';

/**
 * Quote a field for CSV.
 *
 * A leading =, +, - or @ is prefixed with a quote as well: spreadsheets treat such
 * a cell as a formula, so a merchant named "=SUM(A1)" would execute on open. The
 * risk is small for a personal export, but the fix costs one line.
 */
export function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(text);
  const guarded = needsFormulaGuard ? `'${text}` : text;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  // CRLF, because Excel on Windows still wants it and nothing else minds.
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

export interface ExpenseCsvOptions {
  readonly baseCurrency: CurrencyCode;
  /** Resolves category ids to names; ids alone are useless in a spreadsheet. */
  readonly categories?: readonly Category[];
}

export const EXPENSE_CSV_HEADER = [
  'date',
  'amount',
  'currency',
  'amount_base',
  'base_currency',
  'exchange_rate',
  'base_is_estimated',
  'category',
  'merchant',
  'note',
  'source',
  'id',
] as const;

export function expensesToCsv(
  expenses: readonly Expense[],
  options: ExpenseCsvOptions,
): string {
  const names = new Map((options.categories ?? []).map((c) => [c.id, c.name]));

  const rows: (string | number | null)[][] = [[...EXPENSE_CSV_HEADER]];

  for (const expense of expenses) {
    rows.push([
      expense.occurredOn,
      toDecimalString(expense.amount),
      expense.amount.currency,
      // Left blank rather than zero when unknown: a zero would silently understate
      // any total the reader builds from this column.
      expense.base ? toDecimalString(expense.base) : '',
      options.baseCurrency,
      expense.fxRate === null ? '' : expense.fxRate.toFixed(6),
      expense.base === null ? '' : expense.baseEstimated ? 'yes' : 'no',
      expense.categoryId ? (names.get(expense.categoryId) ?? expense.categoryId) : '',
      expense.merchant ?? '',
      expense.note ?? '',
      expense.source,
      expense.id,
    ]);
  }

  return toCsv(rows);
}

export interface CategorySummaryRow {
  readonly category: string;
  readonly totalMinor: number;
  readonly transactionCount: number;
}

/** A per-category summary sheet, the shape an accountant actually wants. */
export function categorySummaryToCsv(
  rows: readonly CategorySummaryRow[],
  baseCurrency: CurrencyCode,
  formatMinor: (minor: number) => string,
): string {
  const out: (string | number | null)[][] = [
    ['category', `total_${baseCurrency.toLowerCase()}`, 'transactions'],
  ];
  for (const row of rows) {
    out.push([row.category, formatMinor(row.totalMinor), row.transactionCount]);
  }
  return toCsv(out);
}
