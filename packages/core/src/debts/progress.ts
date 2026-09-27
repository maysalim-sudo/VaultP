/**
 * How far a debt has been paid down — the bar on a person's page.
 *
 * Computed from the ledger's open loans on whichever side is winning, because
 * that is the debt the person is looking at: "Sami owes you 85, and has paid
 * back 115 of the 200 you lent". Loans already closed by a settlement belong to
 * a finished story and are left out, so the bar starts again from the next loan.
 *
 * Principal only. Interest makes "repaid" slippery — a payment that only covered
 * accrued interest would show no progress at all — and the figure is meant to
 * answer "how much of what I lent has come back".
 */

import type { LedgerBalance } from './ledger.js';

export interface RepaymentProgress {
  /** Principal lent (or borrowed) across the open loans on the owing side. */
  readonly lentMinor: number;
  /** Of that, what has been paid back. */
  readonly repaidMinor: number;
  /** repaid / lent, 0–1. */
  readonly ratio: number;
  /** Which way the debt runs. */
  readonly direction: 'owed_to_me' | 'owed_by_me';
}

export function repaymentProgress(balance: LedgerBalance): RepaymentProgress | null {
  const net = balance.net.amountMinor;
  if (net === 0) return null;

  const direction = net > 0 ? 'owed_to_me' : 'owed_by_me';
  const side = net > 0 ? balance.owedToMe : balance.owedByMe;
  const open = side.loans.filter((position) => !position.closed);
  if (open.length === 0) return null;

  const lentMinor = open.reduce((sum, position) => sum + position.loan.amount.amountMinor, 0);
  const outstanding = open.reduce((sum, position) => sum + position.principalMinor, 0);
  const repaidMinor = Math.max(0, Math.min(lentMinor, lentMinor - outstanding));

  return {
    lentMinor,
    repaidMinor,
    ratio: lentMinor > 0 ? repaidMinor / lentMinor : 0,
    direction,
  };
}
