/**
 * Annual foreign-currency allowance.
 *
 * A Tunisian card carries a yearly ceiling on international payments, so foreign
 * spending is constrained by something a normal budget category cannot express:
 * the limit is annual rather than monthly, it counts only non-TND transactions
 * regardless of what they were for, and running out means subscriptions stop
 * working rather than a budget merely looking bad.
 *
 * The ceiling and the year boundary are configuration, not constants — the rules
 * change, and they differ by card. Nothing here hardcodes an amount.
 */

import type { SqlDatabase } from '../db/adapter.js';
import { BASE_CURRENCY, type CurrencyCode } from '../money/currency.js';
import { type Money, money } from '../money/money.js';
import {
  type IsoDate,
  addDays,
  addMonths,
  compareDates,
  formatDate,
  parseDate,
} from '../time/date.js';
import {
  type Frequency,
  type RecurrenceSpec,
  occurrencesBetween,
} from './recurrence.js';
import { estimateFromSample, latestRateSample } from './rates.js';

export interface AllowanceConfig {
  /** The annual ceiling, in minor units of `currency`. */
  readonly ceilingMinor: number;
  /** Currency the ceiling is denominated in — the card's billing currency. */
  readonly currency: CurrencyCode;
  /** Month the allowance year starts, 1-12. Usually January. */
  readonly yearStartMonth: number;
}

export const DEFAULT_ALLOWANCE_CONFIG: AllowanceConfig = {
  ceilingMinor: 0,
  currency: BASE_CURRENCY,
  yearStartMonth: 1,
};

export interface AllowancePeriod {
  readonly start: IsoDate;
  /** Inclusive. */
  readonly end: IsoDate;
  readonly label: string;
}

export interface CurrencyUsage {
  readonly currency: CurrencyCode;
  /** What the vendors billed, in their own currency. */
  readonly billedMinor: number;
  /** What the card was actually debited, in the allowance currency. */
  readonly chargedMinor: number;
  readonly transactionCount: number;
  /**
   * Charges with no debited value known yet, and so absent from `chargedMinor`.
   *
   * The sum skips them rather than counting them as zero, which is correct but
   * makes the total a floor. Reporting how many were skipped is what stops that
   * floor being read as a fact.
   */
  readonly unvaluedCount: number;
}

export interface AllowanceUsage {
  readonly period: AllowancePeriod;
  readonly ceiling: Money;
  readonly used: Money;
  readonly remaining: Money;
  /** 0-1, and above 1 when the ceiling is already exceeded. */
  readonly ratioUsed: number;
  readonly byCurrency: readonly CurrencyUsage[];
  /** Total charges in the period with no known debited value. */
  readonly unvaluedCount: number;
}

export interface CommittedCharge {
  readonly date: IsoDate;
  readonly ruleId: string;
  readonly name: string;
  readonly estimated: Money;
}

export interface AllowanceForecast extends AllowanceUsage {
  /** Scheduled foreign charges between `asOf` and the end of the period. */
  readonly committed: readonly CommittedCharge[];
  readonly committedTotal: Money;
  readonly projectedTotal: Money;
  /** Positive when the projection exceeds the ceiling. */
  readonly projectedOverrun: Money;
  /** Date the ceiling is projected to run out, or null if it holds. */
  readonly exhaustionDate: IsoDate | null;
  /**
   * Active foreign rules with no past charge to derive a rate from. Their cost is
   * excluded from the projection, so it is a floor, not a guess.
   */
  readonly rulesWithoutRate: readonly string[];
}

export function allowancePeriodFor(
  date: IsoDate,
  config: AllowanceConfig,
): AllowancePeriod {
  const { year, month } = parseDate(date);
  const startYear = month >= config.yearStartMonth ? year : year - 1;
  const start = formatDate({ year: startYear, month: config.yearStartMonth, day: 1 });
  const end = addDays(addMonths(start, 12), -1);
  const label =
    config.yearStartMonth === 1 ? String(startYear) : `${start.slice(0, 7)} → ${end.slice(0, 7)}`;
  return { start, end, label };
}

interface UsageRow {
  currency: string;
  billed: number | null;
  charged: number | null;
  n: number;
  unvalued: number | null;
}

/**
 * Consumption so far in the period containing `asOf`.
 *
 * Counts every expense not in the allowance currency, using the amount actually
 * debited — which includes the bank's spread, because that is what the ceiling is
 * measured against.
 */
export function allowanceUsage(
  db: SqlDatabase,
  config: AllowanceConfig,
  asOf: IsoDate,
): AllowanceUsage {
  const period = allowancePeriodFor(asOf, config);

  const rows = db.all<UsageRow>(
    `SELECT currency,
            SUM(COALESCE(amount_minor, 0))      AS billed,
            SUM(COALESCE(base_amount_minor, 0)) AS charged,
            COUNT(*)                            AS n,
            SUM(CASE WHEN base_amount_minor IS NULL THEN 1 ELSE 0 END) AS unvalued
       FROM expense
      WHERE deleted_at IS NULL
        AND currency IS NOT NULL
        AND currency <> ?
        AND occurred_on >= ?
        AND occurred_on <= ?
      GROUP BY currency
      ORDER BY charged DESC`,
    [config.currency, period.start, period.end],
  );

  const byCurrency: CurrencyUsage[] = rows.map((row) => ({
    currency: row.currency,
    billedMinor: row.billed ?? 0,
    chargedMinor: row.charged ?? 0,
    transactionCount: row.n,
    unvaluedCount: row.unvalued ?? 0,
  }));

  const usedMinor = byCurrency.reduce((total, row) => total + row.chargedMinor, 0);
  const unvaluedCount = byCurrency.reduce((total, row) => total + row.unvaluedCount, 0);
  const ceiling = money(config.ceilingMinor, config.currency);

  return {
    period,
    ceiling,
    used: money(usedMinor, config.currency),
    remaining: money(config.ceilingMinor - usedMinor, config.currency),
    ratioUsed: config.ceilingMinor === 0 ? 0 : usedMinor / config.ceilingMinor,
    byCurrency,
    unvaluedCount,
  };
}

interface RuleRow {
  id: string;
  name: string | null;
  currency: string;
  amount_minor: number | null;
  frequency: string;
  interval_n: number | null;
  anchor_date: string;
}

/**
 * Estimate what one charge on this rule costs in the allowance currency.
 *
 * Uses the rate the bank actually applied, preferring a past charge on the same
 * rule. Estimated rows are excluded as a source, so one guess never becomes the
 * basis for the next.
 */
function estimateCharge(
  db: SqlDatabase,
  rule: RuleRow,
  baseCurrency: CurrencyCode,
): number | null {
  if (rule.amount_minor === null) return null;
  const sample = latestRateSample(db, rule.currency, baseCurrency, rule.id);
  if (!sample) return null;
  return estimateFromSample(money(rule.amount_minor, rule.currency), sample).amountMinor;
}

/**
 * Usage plus what the active subscriptions will add before the period ends.
 *
 * The useful output is `exhaustionDate`: the day the ceiling runs out if nothing
 * changes. For someone whose foreign spending is mostly subscriptions, that is a
 * date worth seeing well in advance — after it, cards start being declined.
 */
export function forecastAllowance(
  db: SqlDatabase,
  config: AllowanceConfig,
  asOf: IsoDate,
): AllowanceForecast {
  const usage = allowanceUsage(db, config, asOf);
  const from = addDays(asOf, 1);
  const rulesWithoutRate: string[] = [];
  const committed: CommittedCharge[] = [];

  if (compareDates(from, usage.period.end) <= 0) {
    const rules = db.all<RuleRow>(
      `SELECT id, name, currency, amount_minor, frequency, interval_n, anchor_date
         FROM recurring_rule
        WHERE deleted_at IS NULL
          AND state = 'active'
          AND currency IS NOT NULL
          AND currency <> ?`,
      [config.currency],
    );

    for (const rule of rules) {
      const estimate = estimateCharge(db, rule, config.currency);
      if (estimate === null) {
        rulesWithoutRate.push(rule.id);
        continue;
      }

      const spec: RecurrenceSpec = {
        frequency: rule.frequency as Frequency,
        intervalN: rule.interval_n ?? 1,
        anchorDate: rule.anchor_date,
      };

      for (const date of occurrencesBetween(spec, from, usage.period.end)) {
        committed.push({
          date,
          ruleId: rule.id,
          name: rule.name ?? rule.id,
          estimated: money(estimate, config.currency),
        });
      }
    }
  }

  committed.sort((a, b) => compareDates(a.date, b.date));

  const committedMinor = committed.reduce(
    (total, charge) => total + charge.estimated.amountMinor,
    0,
  );
  const projectedMinor = usage.used.amountMinor + committedMinor;

  let exhaustionDate: IsoDate | null = null;
  if (config.ceilingMinor > 0) {
    if (usage.used.amountMinor >= config.ceilingMinor) {
      exhaustionDate = asOf;
    } else {
      let running = usage.used.amountMinor;
      for (const charge of committed) {
        running += charge.estimated.amountMinor;
        if (running > config.ceilingMinor) {
          exhaustionDate = charge.date;
          break;
        }
      }
    }
  }

  return {
    ...usage,
    committed,
    committedTotal: money(committedMinor, config.currency),
    projectedTotal: money(projectedMinor, config.currency),
    projectedOverrun: money(
      Math.max(0, projectedMinor - config.ceilingMinor),
      config.currency,
    ),
    exhaustionDate,
    rulesWithoutRate,
  };
}
