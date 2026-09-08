/**
 * Working out what is actually owed.
 *
 * Balances are computed from entries every time, never stored. A stored total
 * would have to be corrected whenever a past entry is edited — precisely the
 * moment the figure matters — and two devices would disagree about it. Every entry
 * is its own row, so a repayment never overwrites the loan it pays down and the
 * history survives to be read back.
 *
 * Payments are applied oldest loan first. That order is arbitrary but it must be
 * *fixed*: with interest involved, applying a payment to a different loan produces
 * a different total, and both devices have to reach the same answer.
 */

import { type Money, money } from '../money/money.js';
import type { CurrencyCode } from '../money/currency.js';
import { type IsoDate, compareDates } from '../time/date.js';
import {
  type InterestTerms,
  NO_INTEREST,
  type PrincipalChange,
  accrueOverTimeline,
} from './interest.js';

/** Which side of the ledger an entry sits on. */
export type DebtDirection = 'owed_to_me' | 'owed_by_me';
export type DebtEntryKind = 'loan' | 'payment' | 'adjustment' | 'settlement';

export interface DebtEntry {
  readonly id: string;
  readonly personId: string;
  readonly kind: DebtEntryKind;
  readonly direction: DebtDirection;
  readonly amount: Money;
  readonly occurredOn: IsoDate;
  readonly note: string | null;
  readonly terms: InterestTerms;
  /** Set when a settlement closed this loan. Interest stops on that date. */
  readonly settledOn: IsoDate | null;
  readonly settlementOf: string | null;
}

export interface LoanPosition {
  readonly loan: DebtEntry;
  readonly principalMinor: number;
  readonly interestMinor: number;
  readonly totalMinor: number;
  readonly closed: boolean;
}

export interface SideBalance {
  readonly totalMinor: number;
  readonly principalMinor: number;
  readonly interestMinor: number;
  /** Paid more than was owed on this side; a credit against future loans. */
  readonly unappliedMinor: number;
  readonly loans: readonly LoanPosition[];
}

export interface LedgerBalance {
  readonly personId: string;
  readonly currency: CurrencyCode;
  readonly asOf: IsoDate;
  readonly owedToMe: SideBalance;
  readonly owedByMe: SideBalance;
  /** Positive when they owe me, negative when I owe them. */
  readonly net: Money;
  readonly settledOn: IsoDate | null;
}

export class MixedCurrencyLedgerError extends Error {
  constructor(personId: string, currencies: readonly string[]) {
    super(
      `Ledger for ${personId} mixes ${currencies.join(' and ')}. Balances are kept ` +
        `per currency; converting a debt at today's rate would change what is owed.`,
    );
    this.name = 'MixedCurrencyLedgerError';
  }
}

/** Signed contribution of a non-loan entry to its side of the ledger. */
function signedAmount(entry: DebtEntry): number {
  switch (entry.kind) {
    case 'loan':
      return entry.amount.amountMinor;
    case 'payment':
      return -entry.amount.amountMinor;
    case 'settlement':
      return -entry.amount.amountMinor;
    case 'adjustment':
      // Adjustments carry their own sign; a correction can go either way.
      return entry.amount.amountMinor;
  }
}

function computeSide(
  entries: readonly DebtEntry[],
  direction: DebtDirection,
  asOf: IsoDate,
): SideBalance {
  const onDate = entries
    .filter((entry) => entry.direction === direction)
    .filter((entry) => compareDates(entry.occurredOn, asOf) <= 0)
    .sort((a, b) =>
      compareDates(a.occurredOn, b.occurredOn) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const loans = onDate.filter(
    (entry) => entry.kind === 'loan' || (entry.kind === 'adjustment' && signedAmount(entry) > 0),
  );
  // Settlements are not reductions. A settlement closes the slate rather than
  // paying into it, and `computeLedger` has already removed everything it closed;
  // counting it here as well would subtract the balance a second time.
  const reductions = onDate.filter(
    (entry) =>
      entry.kind === 'payment' ||
      (entry.kind === 'adjustment' && signedAmount(entry) < 0),
  );

  // Outstanding principal per loan, tracked while allocating payments.
  const outstanding = new Map<string, number>(
    loans.map((loan) => [loan.id, loan.amount.amountMinor]),
  );
  const changes = new Map<string, PrincipalChange[]>(loans.map((loan) => [loan.id, []]));
  let unapplied = 0;

  for (const reduction of reductions) {
    let remaining = Math.abs(signedAmount(reduction));

    for (const loan of loans) {
      if (remaining <= 0) break;
      // A payment cannot pay down a loan that had not been made yet.
      if (compareDates(loan.occurredOn, reduction.occurredOn) > 0) continue;
      if (loan.settledOn && compareDates(loan.settledOn, reduction.occurredOn) < 0) continue;

      const open = outstanding.get(loan.id) ?? 0;
      if (open <= 0) continue;

      const applied = Math.min(open, remaining);
      outstanding.set(loan.id, open - applied);
      changes.get(loan.id)!.push({ date: reduction.occurredOn, deltaMinor: -applied });
      remaining -= applied;
    }

    unapplied += remaining;
  }

  const positions: LoanPosition[] = loans.map((loan) => {
    const closed = loan.settledOn !== null && compareDates(loan.settledOn, asOf) <= 0;
    // A settled loan stops accruing on its settlement date.
    const until = closed ? loan.settledOn! : asOf;

    const accrual = accrueOverTimeline(
      loan.occurredOn,
      loan.amount.amountMinor,
      changes.get(loan.id) ?? [],
      loan.terms,
      until,
    );

    return {
      loan,
      principalMinor: closed ? 0 : accrual.principalMinor,
      interestMinor: closed ? 0 : accrual.interestMinor,
      totalMinor: closed ? 0 : accrual.totalMinor,
      closed,
    };
  });

  const principalMinor = positions.reduce((sum, p) => sum + p.principalMinor, 0);
  const interestMinor = positions.reduce((sum, p) => sum + p.interestMinor, 0);

  return {
    totalMinor: principalMinor + interestMinor - unapplied,
    principalMinor,
    interestMinor,
    unappliedMinor: unapplied,
    loans: positions,
  };
}

/**
 * Balance for one person in one currency.
 *
 * Currencies are never combined: converting a debt at today's rate would change
 * what is owed, and the rate on the day of repayment is not knowable in advance.
 */
export function computeLedger(
  personId: string,
  entries: readonly DebtEntry[],
  asOf: IsoDate,
): LedgerBalance {
  const currencies = [...new Set(entries.map((entry) => entry.amount.currency))];
  if (currencies.length > 1) throw new MixedCurrencyLedgerError(personId, currencies);
  const currency = currencies[0] ?? 'TND';

  const settlement = entries
    .filter((entry) => entry.kind === 'settlement')
    .filter((entry) => compareDates(entry.occurredOn, asOf) <= 0)
    .sort((a, b) => compareDates(b.occurredOn, a.occurredOn))[0];

  /**
   * A settlement wipes the slate on its date: everything up to and including that
   * day was closed out by it, and only what happened afterwards still counts. The
   * settled entries stay in the log — they are the receipt — but they no longer
   * contribute to the balance.
   */
  const live = entries.filter((entry) => {
    if (entry.kind === 'settlement') return false;
    if (!settlement) return true;
    return compareDates(entry.occurredOn, settlement.occurredOn) > 0;
  });

  const owedToMe = computeSide(live, 'owed_to_me', asOf);
  const owedByMe = computeSide(live, 'owed_by_me', asOf);

  return {
    personId,
    currency,
    asOf,
    owedToMe,
    owedByMe,
    net: money(owedToMe.totalMinor - owedByMe.totalMinor, currency),
    settledOn: settlement?.occurredOn ?? null,
  };
}

/** Loans still open, oldest first — the list a reminder screen works from. */
export function openLoans(balance: LedgerBalance): LoanPosition[] {
  return [...balance.owedToMe.loans, ...balance.owedByMe.loans]
    .filter((position) => !position.closed && position.totalMinor > 0)
    .sort((a, b) => compareDates(a.loan.occurredOn, b.loan.occurredOn));
}

export { NO_INTEREST };
