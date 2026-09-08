import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { deriveRate, parseAmount, toDecimalString } from '../money/money.js';
import {
  type AllowanceConfig,
  allowancePeriodFor,
  allowanceUsage,
  forecastAllowance,
} from './allowance.js';

/** 6000 TND a year, calendar year. Configurable, never hardcoded in the module. */
const CONFIG: AllowanceConfig = {
  ceilingMinor: parseAmount('6000.000', 'TND').amountMinor,
  currency: 'TND',
  yearStartMonth: 1,
};

function newVault() {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: 'dev_phone' });

  /** Log a foreign charge the way the app will: billed abroad, debited in TND. */
  function foreignCharge(
    id: string,
    date: string,
    billed: string,
    currency: string,
    charged: string,
    ruleId?: string,
  ) {
    const billedMoney = parseAmount(billed, currency);
    const chargedMoney = parseAmount(charged, 'TND');
    store.commit('expense', id, {
      occurred_on: date,
      amount_minor: billedMoney.amountMinor,
      currency,
      base_amount_minor: chargedMoney.amountMinor,
      fx_rate: deriveRate(billedMoney, chargedMoney),
      ...(ruleId ? { recurring_rule_id: ruleId } : {}),
    });
  }

  /** A foreign charge whose debited value is not known yet. */
  function unvaluedCharge(id: string, date: string, billed: string, currency: string) {
    store.commit('expense', id, {
      occurred_on: date,
      amount_minor: parseAmount(billed, currency).amountMinor,
      currency,
      base_amount_minor: null,
      fx_rate: null,
      fx_estimated: 1,
    });
  }

  function localCharge(id: string, date: string, amount: string) {
    const value = parseAmount(amount, 'TND');
    store.commit('expense', id, {
      occurred_on: date,
      amount_minor: value.amountMinor,
      currency: 'TND',
      base_amount_minor: value.amountMinor,
    });
  }

  function subscription(
    id: string,
    name: string,
    amount: string,
    currency: string,
    anchor: string,
    state = 'active',
  ) {
    store.commit('recurring_rule', id, {
      name,
      amount_minor: parseAmount(amount, currency).amountMinor,
      currency,
      frequency: 'monthly',
      interval_n: 1,
      anchor_date: anchor,
      state,
      auto_log: 0,
    });
  }

  return { db, store, foreignCharge, unvaluedCharge, localCharge, subscription };
}

describe('allowance period', () => {
  it('follows the calendar year by default', () => {
    expect(allowancePeriodFor('2026-09-07', CONFIG)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
      label: '2026',
    });
  });

  it('supports a year that does not start in January', () => {
    const july = { ...CONFIG, yearStartMonth: 7 };
    expect(allowancePeriodFor('2026-09-07', july)).toMatchObject({
      start: '2026-07-01',
      end: '2027-06-30',
    });
    // A date before the start month belongs to the period that began last year.
    expect(allowancePeriodFor('2026-03-01', july)).toMatchObject({
      start: '2025-07-01',
      end: '2026-06-30',
    });
  });
});

describe('usage', () => {
  let vault: ReturnType<typeof newVault>;

  beforeEach(() => {
    vault = newVault();
  });

  it('counts only foreign charges, at the amount the bank debited', () => {
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');
    vault.foreignCharge('e2', '2026-02-15', '20.00', 'USD', '71.500');
    vault.localCharge('e3', '2026-02-16', '450.000'); // domestic, does not count

    const usage = allowanceUsage(vault.db, CONFIG, '2026-09-07');

    expect(toDecimalString(usage.used)).toBe('142.750');
    expect(usage.byCurrency).toEqual([
      {
        currency: 'USD',
        billedMinor: 4000,
        chargedMinor: 142750,
        transactionCount: 2,
        unvaluedCount: 0,
      },
    ]);
  });

  it('uses the debited amount, spread included, not a market conversion', () => {
    // $20 at a 3.42 market rate would be 68.400; the card actually took 71.250.
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');
    const usage = allowanceUsage(vault.db, CONFIG, '2026-09-07');
    expect(usage.used.amountMinor).toBe(71250);
    expect(usage.used.amountMinor).toBeGreaterThan(68400);
  });

  it('ignores charges outside the period and deleted ones', () => {
    vault.foreignCharge('e1', '2025-12-31', '20.00', 'USD', '71.250');
    vault.foreignCharge('e2', '2026-01-01', '20.00', 'USD', '71.250');
    vault.foreignCharge('e3', '2026-05-01', '10.00', 'USD', '35.000');
    vault.store.remove('expense', 'e3');

    expect(allowanceUsage(vault.db, CONFIG, '2026-09-07').used.amountMinor).toBe(71250);
  });

  it('separates several foreign currencies', () => {
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');
    vault.foreignCharge('e2', '2026-01-20', '12.00', 'EUR', '42.000');

    const usage = allowanceUsage(vault.db, CONFIG, '2026-09-07');

    expect(usage.byCurrency.map((c) => c.currency).sort()).toEqual(['EUR', 'USD']);
    expect(toDecimalString(usage.used)).toBe('113.250');
    expect(toDecimalString(usage.remaining)).toBe('5886.750');
  });

  it('counts charges with no known debited value instead of treating them as zero', () => {
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');
    // Billed in a currency never charged before, so there is no rate to derive
    // a value from and no statement has landed. Its cost is unknown, not nil.
    vault.unvaluedCharge('e2', '2026-01-20', '35.00', 'EUR');

    const usage = allowanceUsage(vault.db, CONFIG, '2026-09-07');
    const eur = usage.byCurrency.find((row) => row.currency === 'EUR')!;

    expect(eur.billedMinor).toBe(3500);
    expect(eur.chargedMinor).toBe(0);
    // The zero above is only meaningful next to this: nothing is known yet,
    // which is what stops the row being read as a charge that cost nothing.
    expect(eur.unvaluedCount).toBe(1);
    expect(usage.unvaluedCount).toBe(1);

    // `used` is therefore a floor, and stays exactly the known part.
    expect(toDecimalString(usage.used)).toBe('71.250');
  });

  it('reports nothing unvalued when every charge has been settled', () => {
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');
    expect(allowanceUsage(vault.db, CONFIG, '2026-09-07').unvaluedCount).toBe(0);
  });

  it('reports the fraction consumed', () => {
    vault.foreignCharge('e1', '2026-01-15', '500.00', 'USD', '1500.000');
    expect(allowanceUsage(vault.db, CONFIG, '2026-09-07').ratioUsed).toBeCloseTo(0.25, 6);
  });
});

describe('forecast', () => {
  let vault: ReturnType<typeof newVault>;

  beforeEach(() => {
    vault = newVault();
  });

  it('projects scheduled subscriptions at the rate the bank last applied', () => {
    vault.subscription('r_claude', 'Claude', '20.00', 'USD', '2026-01-15');
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250', 'r_claude');

    const forecast = forecastAllowance(vault.db, CONFIG, '2026-01-20');

    // February through December: 11 more charges at 71.250.
    expect(forecast.committed).toHaveLength(11);
    expect(toDecimalString(forecast.committedTotal)).toBe('783.750');
    expect(toDecimalString(forecast.projectedTotal)).toBe('855.000');
    expect(forecast.exhaustionDate).toBeNull();
  });

  it('names the date the ceiling runs out', () => {
    const tight = { ...CONFIG, ceilingMinor: parseAmount('300.000', 'TND').amountMinor };
    vault.subscription('r_claude', 'Claude', '20.00', 'USD', '2026-01-15');
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250', 'r_claude');

    const forecast = forecastAllowance(vault.db, tight, '2026-01-20');

    // 71.250 spent, then Feb/Mar/Apr take it to 285, and May crosses 300.
    expect(forecast.exhaustionDate).toBe('2026-05-15');
    expect(forecast.projectedOverrun.amountMinor).toBeGreaterThan(0);
  });

  it('excludes paused subscriptions from the projection', () => {
    vault.subscription('r_adobe', 'Adobe', '30.00', 'USD', '2026-01-10', 'paused');
    vault.foreignCharge('e1', '2026-01-10', '30.00', 'USD', '106.000', 'r_adobe');

    const forecast = forecastAllowance(vault.db, CONFIG, '2026-01-20');

    expect(forecast.committed).toHaveLength(0);
    // But the charge already made still counts against the ceiling.
    expect(toDecimalString(forecast.used)).toBe('106.000');
  });

  it('flags a subscription with no past charge rather than inventing a rate', () => {
    vault.subscription('r_new', 'Topaz', '99.00', 'USD', '2026-02-01');

    const forecast = forecastAllowance(vault.db, CONFIG, '2026-01-20');

    expect(forecast.rulesWithoutRate).toEqual(['r_new']);
    expect(forecast.committed).toHaveLength(0);
  });

  it('falls back to a recent charge in the same currency for a new rule', () => {
    vault.foreignCharge('e1', '2026-01-05', '10.00', 'USD', '35.000');
    vault.subscription('r_canva', 'Canva', '20.00', 'USD', '2026-02-01');

    const forecast = forecastAllowance(vault.db, CONFIG, '2026-01-20');

    expect(forecast.rulesWithoutRate).toEqual([]);
    // 3.5 TND per dollar implied by the earlier charge, so $20 -> 70.000.
    expect(toDecimalString(forecast.committed[0]!.estimated)).toBe('70.000');
  });

  it('ignores domestic subscriptions entirely', () => {
    vault.subscription('r_gym', 'Gym', '80.000', 'TND', '2026-01-05');
    const forecast = forecastAllowance(vault.db, CONFIG, '2026-01-20');
    expect(forecast.committed).toHaveLength(0);
  });

  it('reports exhaustion today when the ceiling is already gone', () => {
    const tiny = { ...CONFIG, ceilingMinor: parseAmount('50.000', 'TND').amountMinor };
    vault.foreignCharge('e1', '2026-01-15', '20.00', 'USD', '71.250');

    const forecast = forecastAllowance(vault.db, tiny, '2026-02-01');

    expect(forecast.exhaustionDate).toBe('2026-02-01');
    expect(forecast.remaining.amountMinor).toBeLessThan(0);
  });
});
