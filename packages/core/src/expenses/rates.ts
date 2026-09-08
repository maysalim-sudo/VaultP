/**
 * What the bank actually charged, last time.
 *
 * There is no exchange-rate API anywhere in this app. A foreign charge settles at
 * the bank's rate plus its spread and fees, which is several percent away from any
 * market rate, so a looked-up rate would be wrong in a direction that consistently
 * understates cost. The honest estimate is what the same card was charged for the
 * same currency most recently.
 */

import type { SqlDatabase } from '../db/adapter.js';
import type { CurrencyCode } from '../money/currency.js';
import { type Money, convert, money } from '../money/money.js';

export interface RateSample {
  /** What the vendor billed, in their currency. */
  readonly billedMinor: number;
  /** What the card was debited, in the base currency. */
  readonly chargedMinor: number;
  readonly billedCurrency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
  readonly occurredOn: string;
}

/**
 * Most recent settled charge in `currency`, preferring one from the same rule.
 *
 * A rule-specific sample is better because vendors bill through different
 * processors and the spread differs between them.
 */
export function latestRateSample(
  db: SqlDatabase,
  currency: CurrencyCode,
  baseCurrency: CurrencyCode,
  ruleId?: string,
): RateSample | undefined {
  const select = `SELECT amount_minor, base_amount_minor, occurred_on
                    FROM expense
                   WHERE deleted_at IS NULL
                     AND currency = ?
                     AND amount_minor > 0
                     AND base_amount_minor IS NOT NULL
                     AND (fx_estimated IS NULL OR fx_estimated = 0)`;

  const row =
    (ruleId
      ? db.get<{ amount_minor: number; base_amount_minor: number; occurred_on: string }>(
          `${select} AND recurring_rule_id = ? ORDER BY occurred_on DESC LIMIT 1`,
          [currency, ruleId],
        )
      : undefined) ??
    db.get<{ amount_minor: number; base_amount_minor: number; occurred_on: string }>(
      `${select} ORDER BY occurred_on DESC LIMIT 1`,
      [currency],
    );

  if (!row) return undefined;
  return {
    billedMinor: row.amount_minor,
    chargedMinor: row.base_amount_minor,
    billedCurrency: currency,
    baseCurrency,
    occurredOn: row.occurred_on,
  };
}

/** Apply a past sample's effective rate to a new amount. */
export function estimateFromSample(amount: Money, sample: RateSample): Money {
  return money(
    Math.round((amount.amountMinor * sample.chargedMinor) / sample.billedMinor),
    sample.baseCurrency,
  );
}

/**
 * Best available base-currency value for a foreign amount.
 *
 * `estimated` is false only when the caller supplied the real debited amount.
 * Everything downstream keeps that distinction rather than flattening it, so a
 * total built partly from estimates can say so.
 */
export function estimateInBase(
  db: SqlDatabase,
  amount: Money,
  baseCurrency: CurrencyCode,
  ruleId?: string,
): { value: Money; estimated: boolean } | undefined {
  if (amount.currency === baseCurrency) {
    return { value: amount, estimated: false };
  }
  const sample = latestRateSample(db, amount.currency, baseCurrency, ruleId);
  if (!sample) return undefined;
  return { value: estimateFromSample(amount, sample), estimated: true };
}

/** Convert at an explicit rate, for the rare case the user knows one. */
export function convertAtRate(
  amount: Money,
  baseCurrency: CurrencyCode,
  rate: number,
): Money {
  return convert(amount, baseCurrency, rate);
}
