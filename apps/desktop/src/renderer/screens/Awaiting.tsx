/**
 * Foreign charges whose base-currency value is not yet a fact.
 *
 * Two different situations sit in this list — one carries an estimate derived
 * from a past rate, the other carries nothing at all — and they are labelled
 * differently because they are not the same thing. Both are settled the same
 * way: by typing what the statement actually says.
 */

import { useState } from 'react';

import type { ExpenseDto } from '../../shared/api.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';

export function Awaiting() {
  const unsettled = useVaultQuery(() => api().listUnsettled());
  const rows = unsettled.data ?? [];

  if (rows.length === 0) return null;

  return (
    <>
      <h3>Awaiting a statement</h3>
      <ul className="list">
        {rows.map((expense) => (
          <SettleRow key={expense.id} expense={expense} />
        ))}
      </ul>
    </>
  );
}

function SettleRow({ expense }: { expense: ExpenseDto }) {
  const [charged, setCharged] = useState('');
  const { busy, error, run } = useRunner();

  const settle = () =>
    void run(async () => {
      await api().settleExpense(expense.id, charged);
      setCharged('');
    });

  return (
    <li>
      <span>
        {expense.merchant ?? 'Uncategorised'}
        <em className="muted"> {expense.occurredOn}</em>
        <br />
        <em className="muted small">
          {expense.amount.display} —{' '}
          {expense.base
            ? `estimated ≈ ${expense.base.display}`
            : 'no value known'}
        </em>
      </span>
      <span className="right row">
        <input
          className="narrow"
          value={charged}
          onChange={(event) => setCharged(event.target.value)}
          placeholder={`Debited ${baseCurrency()}`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && charged.trim() !== '') settle();
          }}
        />
        <button disabled={busy || charged.trim() === ''} onClick={settle}>
          Settle
        </button>
        {error ? <span className="error small">{error}</span> : null}
      </span>
    </li>
  );
}
