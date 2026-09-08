/**
 * Turning core values into things the window can render.
 *
 * Formatting happens here, once, on the side that owns the currency table. The
 * renderer never divides by a hundred — it cannot, because it does not know
 * which currencies have two decimal places and which have three.
 */

import { toDecimalString, type Money } from '@vaultp/core';

import type { MoneyDto } from '../../shared/api.js';

export function toMoneyDto(amount: Money): MoneyDto {
  return {
    text: toDecimalString(amount),
    amountMinor: amount.amountMinor,
    currency: amount.currency,
  };
}

/** For the three-state rule: a missing value stays missing, it never becomes 0. */
export function toOptionalMoneyDto(amount: Money | undefined | null): MoneyDto | null {
  return amount ? toMoneyDto(amount) : null;
}
