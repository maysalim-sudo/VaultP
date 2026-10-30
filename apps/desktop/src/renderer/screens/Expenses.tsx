/** Logging and reviewing spending. */

import { useMemo, useState } from 'react';

import { formatAmount, money } from '@vaultp/core';

import type { ExpenseDto } from '../../shared/api.js';
import { Icon, categoryIcon } from '../icons.js';
import { useIntent } from '../nav.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';
import { Awaiting } from './Awaiting.js';
import { ExpenseEditor } from './ExpenseEditor.js';

/** Today, as the vault writes dates. Local, because a day boundary is local. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type Editing = { expense: ExpenseDto | undefined } | null;

/** "TODAY · FRI", "YESTERDAY · THU", or "WED · OCT" — the label beside a day's number. */
function dayLabel(date: string, todayDate: string): string {
  const at = new Date(`${date}T12:00:00`);
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
  const gap = Math.round((Date.parse(`${todayDate}T12:00:00`) - at.getTime()) / 86_400_000);
  if (gap === 0) return `TODAY · ${weekday}`;
  if (gap === 1) return `YESTERDAY · ${weekday}`;
  return `${weekday} · ${at.toLocaleDateString('en-GB', { month: 'short', year: gap > 300 ? 'numeric' : undefined }).toUpperCase()}`;
}

interface Day {
  readonly date: string;
  readonly expenses: ExpenseDto[];
}

function byDay(expenses: readonly ExpenseDto[]): Day[] {
  const days: Day[] = [];
  for (const expense of expenses) {
    const last = days[days.length - 1];
    if (last && last.date === expense.occurredOn) last.expenses.push(expense);
    else days.push({ date: expense.occurredOn, expenses: [expense] });
  }
  return days;
}

/** The day's total in the base currency; "≈" when an estimate is in it. */
function dayTotal(expenses: readonly ExpenseDto[], base: string): string {
  let minor = 0;
  let estimated = false;
  for (const expense of expenses) {
    const value = expense.base ?? (expense.amount.currency === base ? expense.amount : null);
    if (!value || value.currency !== base) continue;
    minor += value.amountMinor;
    estimated ||= expense.baseEstimated;
  }
  return formatAmount(money(minor, base), { estimated });
}

export function Expenses() {
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<Editing>(null);

  useIntent('expenses', (intent) => {
    if (intent.kind === 'newExpense') setEditing({ expense: undefined });
    if (intent.kind === 'expense') {
      void api()
        .getExpense(intent.id)
        .then((expense) => expense && setEditing({ expense }));
    }
  });

  const query = useMemo(() => (categoryId ? { categoryId } : {}), [categoryId]);
  const expenses = useVaultQuery(() => api().listExpenses(query));
  const categories = useVaultQuery(() => api().listCategories());
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();

  const nameOf = (id: string | null) =>
    categories.data?.find((category) => category.id === id)?.name ?? 'Uncategorised';

  const overview = useVaultQuery(() => api().overview());
  const base = baseCurrency();
  const todayDate = today();
  const days = byDay(expenses.data ?? []);
  const month = overview.data?.month;
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' }).toUpperCase();

  return (
    <>
      <div className="head">
        <h2>Spent</h2>
        <div className="row">
          <button className="secondary" disabled={busy} onClick={() => void run(() => api().exportExpensesCsv())}>
            Export CSV
          </button>
          <button className="accent" onClick={() => setEditing({ expense: undefined })}>
            New expense
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {expenses.error ? <p className="error">{expenses.error}</p> : null}

      <div className="split">
        <aside className="split-side">
          <section className="tile">
            <span className="label">
              {monthName} · {month?.transactionCount ?? 0} CHARGES
            </span>
            <span className="monument">
              <span className="dots" style={{ fontSize: 'var(--text-display)' }}>
                {month?.total.figure ?? '—'}
              </span>
              <span className="unit">{month?.total.currency ?? ''}</span>
            </span>
            {month && month.unvaluedCount > 0 ? (
              <span className="sub est">
                + {month.unvaluedCount} foreign charge{month.unvaluedCount === 1 ? '' : 's'} not valued yet
              </span>
            ) : null}
            {overview.data && overview.data.budgets.length > 0 ? (
              <div className="budget-rows">
                {overview.data.budgets.map((budget) => {
                  const tenths = Math.min(10, Math.round((budget.ratioUsed ?? 0) * 10));
                  const over = budget.overspent || (budget.ratioUsed ?? 0) >= 0.8;
                  return (
                    <div key={budget.categoryId} className="budget-row">
                      <span>{budget.name}</span>
                      <span className={`meter ${over ? 'over' : ''}`}>
                        {Array.from({ length: 10 }, (_, index) => (
                          <span key={index} className={index < tenths ? 'on' : ''} />
                        ))}
                      </span>
                      <span className={`mono small ${over ? 'neg' : 'muted'}`}>
                        {Math.round((budget.ratioUsed ?? 0) * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
          <p className="label" style={{ lineHeight: 1.7 }}>
            ≈ = FROM A PAST RATE, REPLACED BY THE BANK&apos;S FIGURE WHEN THE STATEMENT LANDS.
          </p>
        </aside>

        <div className="split-main">
          <div className="chips">
            <button className={`tag ${categoryId === '' ? 'on' : ''}`} onClick={() => setCategoryId('')}>
              All
            </button>
            {categories.data?.map((category) => (
              <button
                key={category.id}
                className={`tag ${categoryId === category.id ? 'on' : ''}`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>

          {days.map((day) => (
            <section key={day.date} className="tile day" aria-label={day.date}>
              <div className="day-head">
                <span className="dots">{day.date.slice(8, 10)}</span>
                <span className="label">{dayLabel(day.date, todayDate)}</span>
                <span className="mono small muted" style={{ marginLeft: 'auto' }}>
                  {dayTotal(day.expenses, base)}
                </span>
              </div>
              <div className="rows">
                {day.expenses.map((expense) => {
                  const category = nameOf(expense.categoryId);
                  const foreign = expense.amount.currency !== base;
                  return (
                    <button key={expense.id} onClick={() => setEditing({ expense })}>
                      <span className="disc">
                        <Icon name={categoryIcon(category)} size={18} />
                      </span>
                      <span className="what">
                        <strong>{expense.merchant ?? category}</strong>
                        <span>
                          {category}
                          {expense.note ? ` · ${expense.note}` : ''}
                        </span>
                      </span>
                      <span className="amt">
                        {/* Three states, kept apart: a real debited figure, an
                            estimate marked as one, or nothing at all — never a
                            zero standing in. */}
                        {foreign ? (
                          expense.base ? (
                            <>
                              <span className={expense.baseEstimated ? 'est' : ''}>
                                {expense.baseEstimated ? '≈ ' : ''}
                                {expense.base.figure}
                              </span>
                              <small>{expense.amount.display}</small>
                            </>
                          ) : (
                            <>
                              <span>{expense.amount.figure}</span>
                              <small className="est">{expense.amount.currency} · AWAITING STATEMENT</small>
                            </>
                          )
                        ) : (
                          <>
                            <span>{expense.amount.figure}</span>
                            <small>{expense.amount.currency}</small>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {expenses.data?.length === 0 ? <div className="empty">Nothing logged here yet</div> : null}

          <Awaiting />
        </div>
      </div>

      {editing ? (
        <ExpenseEditor
          expense={editing.expense}
          categories={categories.data ?? []}
          currencies={currencies.data ?? []}
          today={today()}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
