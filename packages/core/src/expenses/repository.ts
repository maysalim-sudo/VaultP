/**
 * The typed API the UI talks to.
 *
 * Screens must never write raw field maps into the store: the invariants that make
 * reporting correct — money always in minor units, a base-currency value on every
 * row, an estimate always flagged as one — belong in one place, not repeated in
 * every form.
 */

import { uuidv7 } from '../id.js';
import type { SqlValue } from '../db/adapter.js';
import type { VaultStore } from '../db/store.js';
import type { Json } from '../oplog/event.js';
import { BASE_CURRENCY, type CurrencyCode } from '../money/currency.js';
import { type Money, deriveRate, money } from '../money/money.js';
import type { IsoDate } from '../time/date.js';
import { parseDate } from '../time/date.js';
import { estimateInBase } from './rates.js';
import type { Frequency, RuleState } from './recurrence.js';

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly monthlyLimit: Money | null;
  readonly rollover: boolean;
  readonly color: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly archived: boolean;
}

export interface Expense {
  readonly id: string;
  readonly occurredOn: IsoDate;
  /** What the vendor charged, in their currency. */
  readonly amount: Money;
  /** Value in the vault's base currency, or null when not yet known. */
  readonly base: Money | null;
  /** True when `base` came from a past rate rather than a real statement. */
  readonly baseEstimated: boolean;
  readonly fxRate: number | null;
  readonly categoryId: string | null;
  readonly merchant: string | null;
  readonly note: string | null;
  readonly recurringRuleId: string | null;
  readonly source: string;
}

export interface RecurringRule {
  readonly id: string;
  /** Date the rule was created; occurrences before it are not back-filled. */
  readonly createdOn: IsoDate | null;
  readonly name: string;
  readonly amount: Money;
  readonly categoryId: string | null;
  readonly frequency: Frequency;
  readonly intervalN: number;
  readonly anchorDate: IsoDate;
  readonly autoLog: boolean;
  readonly state: RuleState;
  readonly lastSeenAmount: Money | null;
}

export interface AddExpenseInput {
  readonly occurredOn: IsoDate;
  readonly amount: Money;
  /**
   * What the card was actually debited, when known. Supplying it is what turns an
   * estimate into a fact, and is the only way the bank's spread gets recorded.
   */
  readonly charged?: Money;
  readonly categoryId?: string;
  readonly merchant?: string;
  readonly note?: string;
  readonly recurringRuleId?: string;
  readonly source?: 'manual' | 'recurring' | 'receipt' | 'import';
  /** Deterministic ids let two devices create the same auto-logged row. */
  readonly id?: string;
}

export interface ExpenseQuery {
  readonly from?: IsoDate;
  readonly to?: IsoDate;
  readonly categoryId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export class ExpenseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseValidationError';
  }
}

interface ExpenseRow {
  id: string;
  occurred_on: string;
  amount_minor: number;
  currency: string;
  base_amount_minor: number | null;
  fx_rate: number | null;
  fx_estimated: number | null;
  category_id: string | null;
  merchant: string | null;
  note: string | null;
  recurring_rule_id: string | null;
  source: string | null;
}

interface CategoryRow {
  id: string;
  name: string | null;
  monthly_limit_minor: number | null;
  rollover: number | null;
  color: string | null;
  icon: string | null;
  sort_order: number | null;
  archived: number | null;
}

interface RuleRow {
  id: string;
  created_at: string | null;
  name: string | null;
  amount_minor: number | null;
  currency: string | null;
  category_id: string | null;
  frequency: string;
  interval_n: number | null;
  anchor_date: string;
  auto_log: number | null;
  state: string | null;
  last_seen_amount_minor: number | null;
}

export class ExpenseRepository {
  readonly baseCurrency: CurrencyCode;

  constructor(
    private readonly store: VaultStore,
    baseCurrency: CurrencyCode = BASE_CURRENCY,
  ) {
    this.baseCurrency = baseCurrency;
  }

  // ------------------------------------------------------------- categories

  addCategory(input: {
    name: string;
    monthlyLimit?: Money;
    rollover?: boolean;
    color?: string;
    icon?: string;
    sortOrder?: number;
    id?: string;
  }): Category {
    if (input.name.trim() === '') {
      throw new ExpenseValidationError('A category needs a name.');
    }
    const id = input.id ?? uuidv7();
    this.store.commit('category', id, {
      name: input.name.trim(),
      monthly_limit_minor: input.monthlyLimit?.amountMinor ?? null,
      rollover: input.rollover ?? false,
      color: input.color ?? null,
      icon: input.icon ?? null,
      sort_order: input.sortOrder ?? 0,
      archived: false,
    });
    return this.getCategory(id)!;
  }

  /**
   * The category with this name, created if there is none — what "Other…" in
   * an expense form does with what was typed.
   *
   * Matched without regard to case, so "food" typed in a hurry picks the
   * existing "Food" instead of starting a twin that splits the month's spending
   * in two. An archived match is brought back rather than duplicated. A new
   * one goes after the existing categories, not into the middle of them.
   */
  ensureCategory(input: { name: string; icon?: string }): Category {
    const name = input.name.trim();
    if (name === '') throw new ExpenseValidationError('A category needs a name.');

    const existing = this.listCategories(true).find(
      (category) => category.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      if (existing.archived) this.store.commit('category', existing.id, { archived: false });
      return this.getCategory(existing.id)!;
    }

    const last = this.listCategories(true).reduce((max, category) => Math.max(max, category.sortOrder), 0);
    const icon = input.icon?.trim();
    return this.addCategory({ name, sortOrder: last + 1, ...(icon ? { icon } : {}) });
  }

  /** Archive rather than delete: past expenses must keep a readable category. */
  archiveCategory(id: string): void {
    this.store.commit('category', id, { archived: true });
  }

  getCategory(id: string): Category | undefined {
    const row = this.store.database.get<CategoryRow>(
      'SELECT * FROM category WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? this.toCategory(row) : undefined;
  }

  listCategories(includeArchived = false): Category[] {
    const rows = this.store.database.all<CategoryRow>(
      `SELECT * FROM category
        WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND (archived IS NULL OR archived = 0)'}
        ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map((row) => this.toCategory(row));
  }

  // --------------------------------------------------------------- expenses

  addExpense(input: AddExpenseInput): Expense {
    parseDate(input.occurredOn);
    if (input.amount.amountMinor === 0) {
      throw new ExpenseValidationError('An expense needs a non-zero amount.');
    }
    if (input.charged && input.charged.currency !== this.baseCurrency) {
      throw new ExpenseValidationError(
        `The debited amount must be in ${this.baseCurrency}, not ${input.charged.currency}.`,
      );
    }

    const id = input.id ?? uuidv7();
    const conversion = this.resolveBase(input);

    this.store.commit('expense', id, {
      occurred_on: input.occurredOn,
      amount_minor: input.amount.amountMinor,
      currency: input.amount.currency,
      base_amount_minor: conversion.base?.amountMinor ?? null,
      fx_rate: conversion.rate,
      fx_estimated: conversion.estimated,
      category_id: input.categoryId ?? null,
      merchant: input.merchant ?? null,
      note: input.note ?? null,
      recurring_rule_id: input.recurringRuleId ?? null,
      source: input.source ?? 'manual',
    });

    return this.getExpense(id)!;
  }

  /**
   * Work out the base-currency value.
   *
   * Three cases, kept distinct on purpose: a real debited amount is a fact, a rate
   * carried over from a past charge is an estimate, and a foreign currency never
   * charged before has no value at all. Filling the third case with a guess would
   * put an invented number into totals.
   */
  private resolveBase(input: AddExpenseInput): {
    base: Money | null;
    rate: number | null;
    estimated: boolean;
  } {
    if (input.amount.currency === this.baseCurrency) {
      return { base: input.amount, rate: 1, estimated: false };
    }
    if (input.charged) {
      return {
        base: input.charged,
        rate: deriveRate(input.amount, input.charged),
        estimated: false,
      };
    }
    const guess = estimateInBase(
      this.store.database,
      input.amount,
      this.baseCurrency,
      input.recurringRuleId,
    );
    if (!guess) return { base: null, rate: null, estimated: true };
    return {
      base: guess.value,
      rate: deriveRate(input.amount, guess.value),
      estimated: true,
    };
  }

  /** Record what the statement actually showed, replacing an estimate with a fact. */
  settleExpense(id: string, charged: Money): Expense {
    const existing = this.getExpense(id);
    if (!existing) throw new ExpenseValidationError(`No expense ${id}.`);
    if (charged.currency !== this.baseCurrency) {
      throw new ExpenseValidationError(
        `The debited amount must be in ${this.baseCurrency}.`,
      );
    }
    this.store.commit('expense', id, {
      base_amount_minor: charged.amountMinor,
      fx_rate: deriveRate(existing.amount, charged),
      fx_estimated: false,
    });
    return this.getExpense(id)!;
  }

  /**
   * Correct an expense.
   *
   * Changing the amount re-derives the base-currency value, because the old one
   * belonged to the old amount: leaving it would leave a row whose TND figure and
   * USD figure disagree, and every total built on it would be quietly wrong.
   */
  updateExpense(
    id: string,
    patch: Partial<
      Pick<AddExpenseInput, 'occurredOn' | 'merchant' | 'note' | 'amount' | 'charged'>
    > & {
      /** Null clears it: an expense that was filed under the wrong heading and
          has no right one is better uncategorised than left where it was. */
      readonly categoryId?: string | null;
    },
  ): Expense {
    const existing = this.getExpense(id);
    if (!existing) throw new ExpenseValidationError(`No expense ${id}.`);

    const fields: Record<string, Json> = {};

    if (patch.occurredOn !== undefined) {
      parseDate(patch.occurredOn);
      fields.occurred_on = patch.occurredOn;
    }
    if (patch.categoryId !== undefined) fields.category_id = patch.categoryId;
    if (patch.merchant !== undefined) fields.merchant = patch.merchant;
    if (patch.note !== undefined) fields.note = patch.note;

    if (patch.amount !== undefined || patch.charged !== undefined) {
      const amount = patch.amount ?? existing.amount;
      if (amount.amountMinor === 0) {
        throw new ExpenseValidationError('An expense needs a non-zero amount.');
      }
      if (patch.charged && patch.charged.currency !== this.baseCurrency) {
        throw new ExpenseValidationError(
          `The debited amount must be in ${this.baseCurrency}, not ${patch.charged.currency}.`,
        );
      }

      const conversion = this.resolveBase({
        occurredOn: patch.occurredOn ?? existing.occurredOn,
        amount,
        ...(patch.charged ? { charged: patch.charged } : {}),
        ...(existing.recurringRuleId ? { recurringRuleId: existing.recurringRuleId } : {}),
      });

      fields.amount_minor = amount.amountMinor;
      fields.currency = amount.currency;
      fields.base_amount_minor = conversion.base?.amountMinor ?? null;
      fields.fx_rate = conversion.rate;
      fields.fx_estimated = conversion.estimated;
    }

    if (Object.keys(fields).length > 0) this.store.commit('expense', id, fields);
    return this.getExpense(id)!;
  }

  deleteExpense(id: string): void {
    this.store.remove('expense', id);
  }

  getExpense(id: string): Expense | undefined {
    const row = this.store.database.get<ExpenseRow>(
      'SELECT * FROM expense WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? this.toExpense(row) : undefined;
  }

  listExpenses(query: ExpenseQuery = {}): Expense[] {
    const where: string[] = ['deleted_at IS NULL'];
    const params: SqlValue[] = [];

    if (query.from) {
      where.push('occurred_on >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('occurred_on <= ?');
      params.push(query.to);
    }
    if (query.categoryId) {
      where.push('category_id = ?');
      params.push(query.categoryId);
    }

    // Newest first, then by id so equal dates keep a stable order between devices.
    let sql = `SELECT * FROM expense WHERE ${where.join(' AND ')}
               ORDER BY occurred_on DESC, id DESC`;
    if (query.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(query.limit);
      if (query.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    return this.store.database
      .all<ExpenseRow>(sql, params)
      .map((row) => this.toExpense(row));
  }

  /** Expenses whose base-currency value is still a guess, or missing entirely. */
  listUnsettled(): Expense[] {
    return this.store.database
      .all<ExpenseRow>(
        `SELECT * FROM expense
          WHERE deleted_at IS NULL AND fx_estimated = 1
          ORDER BY occurred_on DESC`,
      )
      .map((row) => this.toExpense(row));
  }

  // ---------------------------------------------------------------- rules

  addRule(input: {
    name: string;
    amount: Money;
    frequency: Frequency;
    anchorDate: IsoDate;
    intervalN?: number;
    categoryId?: string;
    autoLog?: boolean;
    id?: string;
  }): RecurringRule {
    parseDate(input.anchorDate);
    const id = input.id ?? uuidv7();
    this.store.commit('recurring_rule', id, {
      name: input.name,
      amount_minor: input.amount.amountMinor,
      currency: input.amount.currency,
      category_id: input.categoryId ?? null,
      frequency: input.frequency,
      interval_n: input.intervalN ?? 1,
      anchor_date: input.anchorDate,
      auto_log: input.autoLog ?? false,
      state: 'active',
      last_seen_amount_minor: input.amount.amountMinor,
    });
    return this.getRule(id)!;
  }

  setRuleState(id: string, state: RuleState): RecurringRule {
    this.store.commit('recurring_rule', id, { state });
    return this.getRule(id)!;
  }

  /**
   * Change the price, keeping the previous one.
   *
   * `last_seen_amount_minor` is what makes a silent subscription price rise
   * visible: the comparison is already stored, so detecting it is a subtraction
   * rather than a trawl through history.
   */
  updateRuleAmount(id: string, amount: Money): RecurringRule {
    const existing = this.getRule(id);
    if (!existing) throw new ExpenseValidationError(`No rule ${id}.`);
    this.store.commit('recurring_rule', id, {
      last_seen_amount_minor: existing.amount.amountMinor,
      amount_minor: amount.amountMinor,
      currency: amount.currency,
    });
    return this.getRule(id)!;
  }

  getRule(id: string): RecurringRule | undefined {
    const row = this.store.database.get<RuleRow>(
      'SELECT * FROM recurring_rule WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? this.toRule(row) : undefined;
  }

  listRules(state?: RuleState): RecurringRule[] {
    const rows = state
      ? this.store.database.all<RuleRow>(
          'SELECT * FROM recurring_rule WHERE deleted_at IS NULL AND state = ? ORDER BY name',
          [state],
        )
      : this.store.database.all<RuleRow>(
          'SELECT * FROM recurring_rule WHERE deleted_at IS NULL ORDER BY name',
        );
    return rows.map((row) => this.toRule(row));
  }

  // ---------------------------------------------------------------- mapping

  private toCategory(row: CategoryRow): Category {
    return {
      id: row.id,
      name: row.name ?? '',
      monthlyLimit:
        row.monthly_limit_minor === null
          ? null
          : money(row.monthly_limit_minor, this.baseCurrency),
      rollover: row.rollover === 1,
      color: row.color,
      icon: row.icon,
      sortOrder: row.sort_order ?? 0,
      archived: row.archived === 1,
    };
  }

  private toExpense(row: ExpenseRow): Expense {
    return {
      id: row.id,
      occurredOn: row.occurred_on,
      amount: money(row.amount_minor, row.currency),
      base:
        row.base_amount_minor === null
          ? null
          : money(row.base_amount_minor, this.baseCurrency),
      baseEstimated: row.fx_estimated === 1,
      fxRate: row.fx_rate,
      categoryId: row.category_id,
      merchant: row.merchant,
      note: row.note,
      recurringRuleId: row.recurring_rule_id,
      source: row.source ?? 'manual',
    };
  }

  private toRule(row: RuleRow): RecurringRule {
    const currency = row.currency ?? this.baseCurrency;
    return {
      id: row.id,
      // Stored as a full timestamp; only the calendar date matters here.
      createdOn: row.created_at ? row.created_at.slice(0, 10) : null,
      name: row.name ?? '',
      amount: money(row.amount_minor ?? 0, currency),
      categoryId: row.category_id,
      frequency: row.frequency as Frequency,
      intervalN: row.interval_n ?? 1,
      anchorDate: row.anchor_date,
      autoLog: row.auto_log === 1,
      state: (row.state ?? 'active') as RuleState,
      lastSeenAmount:
        row.last_seen_amount_minor === null
          ? null
          : money(row.last_seen_amount_minor, currency),
    };
  }
}
