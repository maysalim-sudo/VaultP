import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { parseAmount, toDecimalString } from '../money/money.js';
import {
  InvalidInterestTermsError,
  accrueOverTimeline,
  monthsBetween,
  periodsBetween,
} from './interest.js';
import { MixedCurrencyLedgerError, computeLedger, openLoans } from './ledger.js';
import { DebtRepository, DebtValidationError } from './repository.js';

const tnd = (value: string) => parseAmount(value, 'TND');

function newRepo(device = 'dev_phone') {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device });
  return { repo: new DebtRepository(store), store, db };
}

describe('elapsed periods', () => {
  it('treats a calendar month as one month regardless of its length', () => {
    expect(monthsBetween('2026-01-15', '2026-02-15')).toBeCloseTo(1, 9);
    expect(monthsBetween('2026-02-15', '2026-03-15')).toBeCloseTo(1, 9);
    expect(monthsBetween('2026-01-15', '2026-07-15')).toBeCloseTo(6, 9);
  });

  it('measures a part month against that month own length', () => {
    // 15 days into a 28-day February.
    expect(monthsBetween('2026-02-01', '2026-02-16')).toBeCloseTo(15 / 28, 6);
    // 15 days into a 31-day January is a smaller fraction of a month.
    expect(monthsBetween('2026-01-01', '2026-01-16')).toBeCloseTo(15 / 31, 6);
  });

  it('never returns a negative or reversed span', () => {
    expect(monthsBetween('2026-06-01', '2026-01-01')).toBe(0);
    expect(periodsBetween('2026-06-01', '2026-06-01', 'daily')).toBe(0);
  });

  it('counts days and years', () => {
    expect(periodsBetween('2026-01-01', '2026-01-31', 'daily')).toBe(30);
    expect(periodsBetween('2026-01-01', '2027-01-01', 'yearly')).toBeCloseTo(1, 9);
  });
});

describe('interest accrual', () => {
  const monthly2pc = { method: 'simple', rate: 0.02, period: 'monthly' } as const;

  it('accrues nothing without terms', () => {
    const result = accrueOverTimeline(
      '2026-01-01',
      100_000,
      [],
      { method: 'none', rate: 0, period: 'monthly' },
      '2027-01-01',
    );
    expect(result.interestMinor).toBe(0);
    expect(result.totalMinor).toBe(100_000);
  });

  it('accrues simple interest on the principal', () => {
    // 100.000 at 2% a month for 6 months = 12.000 interest.
    const result = accrueOverTimeline('2026-01-01', 100_000, [], monthly2pc, '2026-07-01');
    expect(result.interestMinor).toBe(12_000);
    expect(result.totalMinor).toBe(112_000);
  });

  it('reduces later interest when a payment lands part-way', () => {
    // 100.000 for 3 months, then 50.000 repaid, then 3 months on the remainder.
    const result = accrueOverTimeline(
      '2026-01-01',
      100_000,
      [{ date: '2026-04-01', deltaMinor: -50_000 }],
      monthly2pc,
      '2026-07-01',
    );

    // 3 months on 100 (6.000) plus 3 on 50 (3.000).
    expect(result.interestMinor).toBe(9_000);
    expect(result.principalMinor).toBe(50_000);
  });

  it('compounds when asked to', () => {
    const compound = { method: 'compound', rate: 0.02, period: 'monthly' } as const;
    const result = accrueOverTimeline('2026-01-01', 100_000, [], compound, '2026-07-01');

    // 100000 * 1.02^6 = 112616.24, against 112000 simple.
    expect(result.totalMinor).toBe(112_616);
    expect(result.totalMinor).toBeGreaterThan(112_000);
  });

  it('does not let accrued interest earn interest under the simple method', () => {
    const oneYear = accrueOverTimeline('2026-01-01', 100_000, [], monthly2pc, '2027-01-01');
    // Exactly 24%, not 26.8% as compounding would give.
    expect(oneYear.interestMinor).toBe(24_000);
  });

  it('rejects a rate entered as a whole percentage', () => {
    expect(() =>
      accrueOverTimeline(
        '2026-01-01',
        100_000,
        [],
        { method: 'simple', rate: 5, period: 'monthly' },
        '2026-02-01',
      ),
    ).toThrow(InvalidInterestTermsError);
  });
});

describe('ledger', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
  });

  it('tracks a simple loan and repayment', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('200.000'), occurredOn: '2026-01-10' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('50.000'),
      occurredOn: '2026-02-10',
    });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-03-01')!;
    expect(toDecimalString(balance.net)).toBe('150.000');
  });

  it('nets money owed in both directions', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('200.000'), occurredOn: '2026-01-10' });
    ctx.repo.borrow({ personId: 'p_sami', amount: tnd('80.000'), occurredOn: '2026-01-20' });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-03-01')!;
    expect(toDecimalString(balance.net)).toBe('120.000');
  });

  it('goes negative when I owe them more', () => {
    ctx.repo.borrow({ personId: 'p_sami', amount: tnd('300.000'), occurredOn: '2026-01-10' });
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('100.000'), occurredOn: '2026-01-15' });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-03-01')!;
    expect(toDecimalString(balance.net)).toBe('-200.000');
  });

  it('records each partial payment as its own entry', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('300.000'), occurredOn: '2026-01-01' });
    for (const [date, amount] of [
      ['2026-02-01', '100.000'],
      ['2026-03-01', '100.000'],
    ] as const) {
      ctx.repo.recordRepaymentToMe({
        personId: 'p_sami',
        amount: tnd(amount),
        occurredOn: date,
      });
    }

    expect(ctx.repo.entriesFor('p_sami')).toHaveLength(3);
    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-04-01')!.net)).toBe('100.000');
  });

  it('applies payments to the oldest loan first, deterministically', () => {
    ctx.repo.lend({
      id: 'l1',
      personId: 'p_sami',
      amount: tnd('100.000'),
      occurredOn: '2026-01-01',
    });
    ctx.repo.lend({
      id: 'l2',
      personId: 'p_sami',
      amount: tnd('100.000'),
      occurredOn: '2026-02-01',
    });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('120.000'),
      occurredOn: '2026-03-01',
    });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-04-01')!;
    const positions = balance.owedToMe.loans;

    expect(positions.find((p) => p.loan.id === 'l1')?.principalMinor).toBe(0);
    expect(positions.find((p) => p.loan.id === 'l2')?.principalMinor).toBe(80_000);
  });

  it('carries an overpayment as credit rather than losing it', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('100.000'), occurredOn: '2026-01-01' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('150.000'),
      occurredOn: '2026-02-01',
    });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-03-01')!;
    expect(balance.owedToMe.unappliedMinor).toBe(50_000);
    expect(toDecimalString(balance.net)).toBe('-50.000');
  });

  it('ignores a payment dated before the loan it would pay', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('100.000'), occurredOn: '2026-06-01' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('40.000'),
      occurredOn: '2026-01-01',
    });

    const balance = ctx.repo.ledgerFor('p_sami', '2026-07-01')!;
    // Still credit, not applied to a loan that did not exist yet.
    expect(balance.owedToMe.unappliedMinor).toBe(40_000);
  });

  it('answers what the balance was at an earlier date', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('200.000'), occurredOn: '2026-01-10' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('200.000'),
      occurredOn: '2026-06-10',
    });

    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-03-01')!.net)).toBe('200.000');
    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-07-01')!.net)).toBe('0.000');
  });

  it('refuses to combine currencies in one ledger', () => {
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('100.000'), occurredOn: '2026-01-01' });
    ctx.repo.lend({
      personId: 'p_sami',
      amount: parseAmount('50.00', 'USD'),
      occurredOn: '2026-02-01',
    });

    expect(() => ctx.repo.ledgerFor('p_sami', '2026-03-01')).toThrow(
      MixedCurrencyLedgerError,
    );
  });
});

describe('interest on a real ledger', () => {
  it('accrues on an outstanding loan and stops at settlement', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    ctx.repo.lend({
      personId: 'p_sami',
      amount: tnd('1000.000'),
      occurredOn: '2026-01-01',
      interest: { method: 'simple', rate: 0.01, period: 'monthly' },
    });

    const atSixMonths = ctx.repo.ledgerFor('p_sami', '2026-07-01')!;
    expect(atSixMonths.owedToMe.principalMinor).toBe(1_000_000);
    expect(atSixMonths.owedToMe.interestMinor).toBe(60_000);
    expect(toDecimalString(atSixMonths.net)).toBe('1060.000');
  });

  it('is computed on read, so an old ledger keeps growing until settled', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    ctx.repo.lend({
      personId: 'p_sami',
      amount: tnd('1000.000'),
      occurredOn: '2026-01-01',
      interest: { method: 'simple', rate: 0.01, period: 'monthly' },
    });

    const six = ctx.repo.ledgerFor('p_sami', '2026-07-01')!.net.amountMinor;
    const twelve = ctx.repo.ledgerFor('p_sami', '2027-01-01')!.net.amountMinor;

    expect(twelve).toBeGreaterThan(six);
    expect(twelve).toBe(1_120_000);
  });
});

describe('settlement', () => {
  it('writes an immutable record and zeroes the balance', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('200.000'), occurredOn: '2026-01-10' });

    const settlement = ctx.repo.settle('p_sami', '2026-03-01', 'Paid in cash')!;

    expect(settlement.kind).toBe('settlement');
    expect(toDecimalString(settlement.amount)).toBe('200.000');
    expect(settlement.occurredOn).toBe('2026-03-01');
    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-03-01')!.net)).toBe('0.000');
  });

  it('stops interest at the settlement date', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    ctx.repo.lend({
      personId: 'p_sami',
      amount: tnd('1000.000'),
      occurredOn: '2026-01-01',
      interest: { method: 'simple', rate: 0.01, period: 'monthly' },
    });
    ctx.repo.settle('p_sami', '2026-07-01');

    // A year later the ledger is still zero, not still accruing.
    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2027-07-01')!.net)).toBe('0.000');
  });

  it('leaves the history intact after settling', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    ctx.repo.lend({ personId: 'p_sami', amount: tnd('200.000'), occurredOn: '2026-01-10' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('50.000'),
      occurredOn: '2026-02-10',
    });
    ctx.repo.settle('p_sami', '2026-03-01');

    const entries = ctx.repo.entriesFor('p_sami');
    expect(entries.map((e) => e.kind)).toEqual(['loan', 'payment', 'settlement']);
  });

  it('does nothing when there is nothing to settle', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    expect(ctx.repo.settle('p_sami', '2026-03-01')).toBeUndefined();
  });
});

describe('corrections', () => {
  it('voids an entry without erasing it', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    const wrong = ctx.repo.lend({
      personId: 'p_sami',
      amount: tnd('500.000'),
      occurredOn: '2026-01-10',
    });

    ctx.repo.voidEntry(wrong.id, 'Entered twice by mistake');

    expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-03-01')!.net)).toBe('0.000');
    // The mistake and its correction are both still visible.
    expect(ctx.repo.entriesFor('p_sami')).toHaveLength(2);
  });

  it('keeps the full edit history of an entry', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    const loan = ctx.repo.lend({
      personId: 'p_sami',
      amount: tnd('200.000'),
      occurredOn: '2026-01-10',
    });
    ctx.repo.settle('p_sami', '2026-03-01');

    // Creation plus the settlement stamp, never an overwrite.
    expect(ctx.repo.historyOf(loan.id).length).toBeGreaterThanOrEqual(2);
  });
});

describe('validation', () => {
  it('rejects empty names and non-positive amounts', () => {
    const ctx = newRepo();
    expect(() => ctx.repo.addPerson({ name: '  ' })).toThrow(DebtValidationError);
    ctx.repo.addPerson({ id: 'p', name: 'Sami' });
    expect(() =>
      ctx.repo.lend({ personId: 'p', amount: tnd('0'), occurredOn: '2026-01-01' }),
    ).toThrow(DebtValidationError);
  });
});

describe('dashboard', () => {
  it('lists non-zero balances, largest first', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p1', name: 'Sami' });
    ctx.repo.addPerson({ id: 'p2', name: 'Leila' });
    ctx.repo.addPerson({ id: 'p3', name: 'Karim' });

    ctx.repo.lend({ personId: 'p1', amount: tnd('100.000'), occurredOn: '2026-01-01' });
    ctx.repo.borrow({ personId: 'p2', amount: tnd('500.000'), occurredOn: '2026-01-01' });
    ctx.repo.lend({ personId: 'p3', amount: tnd('50.000'), occurredOn: '2026-01-01' });
    ctx.repo.recordRepaymentToMe({
      personId: 'p3',
      amount: tnd('50.000'),
      occurredOn: '2026-01-05',
    });

    const balances = ctx.repo.allBalances('2026-02-01');

    // Karim settled up and drops off; Leila first as the largest absolute amount.
    expect(balances.map((b) => b.personId)).toEqual(['p2', 'p1']);
  });

  it('lists open loans oldest first', () => {
    const ctx = newRepo();
    ctx.repo.addPerson({ id: 'p1', name: 'Sami' });
    ctx.repo.lend({
      id: 'old',
      personId: 'p1',
      amount: tnd('100.000'),
      occurredOn: '2026-01-01',
    });
    ctx.repo.lend({
      id: 'new',
      personId: 'p1',
      amount: tnd('100.000'),
      occurredOn: '2026-05-01',
    });

    const open = openLoans(ctx.repo.ledgerFor('p1', '2026-06-01')!);
    expect(open.map((p) => p.loan.id)).toEqual(['old', 'new']);
  });
});

describe('across devices', () => {
  it('reaches the same balance on both after syncing', () => {
    const phone = newRepo('dev_phone');
    const desktop = newRepo('dev_desktop');

    phone.repo.addPerson({ id: 'p_sami', name: 'Sami' });
    phone.repo.lend({
      personId: 'p_sami',
      amount: tnd('300.000'),
      occurredOn: '2026-01-01',
    });
    desktop.store.ingest(phone.store.pendingUploads());

    // Each records a different repayment while offline.
    phone.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('100.000'),
      occurredOn: '2026-02-01',
    });
    desktop.repo.recordRepaymentToMe({
      personId: 'p_sami',
      amount: tnd('50.000'),
      occurredOn: '2026-02-15',
    });

    desktop.store.ingest(phone.store.pendingUploads());
    phone.store.ingest(desktop.store.pendingUploads());

    // Both payments survive: neither overwrote the other.
    for (const ctx of [phone, desktop]) {
      expect(toDecimalString(ctx.repo.ledgerFor('p_sami', '2026-03-01')!.net)).toBe(
        '150.000',
      );
    }
  });
});

describe('computeLedger directly', () => {
  it('returns a zero balance for an empty entry list', () => {
    const balance = computeLedger('p1', [], '2026-01-01');
    expect(balance.net.amountMinor).toBe(0);
    expect(balance.settledOn).toBeNull();
  });
});
