/** Logging and reviewing spending. */

import { useMemo, useState } from 'react';

import type { ExpenseDto } from '../../shared/api.js';
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

  return (
    <>
      <div className="head">
        <h2>Expenses</h2>
        <div className="row">
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => api().exportExpensesCsv())}
          >
            Export CSV
          </button>
          <button onClick={() => setEditing({ expense: undefined })}>New expense</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {expenses.error ? <p className="error">{expenses.error}</p> : null}

      <ul className="list">
        {expenses.data?.map((expense) => (
          <li key={expense.id} className="clickable" onClick={() => setEditing({ expense })}>
            <span>
              {expense.merchant ?? nameOf(expense.categoryId)}
              {expense.merchant ? (
                <em className="muted"> · {nameOf(expense.categoryId)}</em>
              ) : null}
            </span>
            <span className="right">
              {expense.amount.display}
              {expense.amount.currency !== baseCurrency() ? (
                // Three states, kept apart: a real debited figure, an estimate
                // marked as one, or nothing at all — never a zero standing in.
                <em className="muted">
                  {expense.base
                    ? ` ${expense.baseEstimated ? '≈ ' : ''}${expense.base.display}`
                    : ' awaiting statement'}
                </em>
              ) : null}
              <em className="muted"> {expense.occurredOn}</em>
            </span>
          </li>
        ))}
      </ul>

      {expenses.data?.length === 0 ? <p className="muted small">Nothing logged yet.</p> : null}

      <Awaiting />

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
