/** Where the month stands, and where it is heading. */

import { useState } from 'react';

import type { AllowanceConfigDto, AllowanceDto, BudgetDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { useNav } from '../nav.js';
import { noteBackground } from '../notes/NoteEditor.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

export function Dashboard() {
  const overview = useVaultQuery(() => api().overview());
  const notes = useVaultQuery(() => api().listNotes({ view: 'all' }));
  const accounts = useVaultQuery(() => api().listAccounts(false));
  const [configuring, setConfiguring] = useState(false);
  const nav = useNav();
  const data = overview.data;

  // Pinned first, then the most recently touched: what you were working on.
  const recentNotes = [...(notes.data ?? [])]
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    )
    .slice(0, 6);

  return (
    <>
      <div className="head">
        <h2>Dashboard</h2>
        <button className="secondary" onClick={() => setConfiguring(true)}>
          Foreign allowance
        </button>
      </div>

      {overview.error ? <p className="error">{overview.error}</p> : null}

      {/* Notes first: the reason this app exists. One click to a blank note. */}
      <section className="quick">
        <button className="quick-note" onClick={() => nav.go('notes', { kind: 'newNote', with: 'text' })}>
          Take a note…
        </button>
        <button
          className="secondary quick-icon"
          title="New checklist"
          aria-label="New checklist"
          onClick={() => nav.go('notes', { kind: 'newNote', with: 'checklist' })}
        >
          ☑
        </button>
        <button
          className="secondary quick-icon"
          title="New note with an image"
          aria-label="New note with an image"
          onClick={() => nav.go('notes', { kind: 'newNote', with: 'image' })}
        >
          🖼
        </button>
        <span className="quick-gap" />
        <button className="secondary" onClick={() => nav.go('expenses', { kind: 'newExpense' })}>
          + Expense
        </button>
        <button className="secondary" onClick={() => nav.go('debts', { kind: 'newPerson' })}>
          + Person
        </button>
        <button className="secondary" onClick={() => nav.go('accounts', { kind: 'newAccount' })}>
          + Account
        </button>
        <button className="secondary" onClick={() => nav.go('documents', { kind: 'newDocument' })}>
          + Document
        </button>
      </section>

      {recentNotes.length > 0 ? (
        <section className="recent-notes">
          {recentNotes.map((note) => (
            <button
              key={note.id}
              className="recent-note"
              style={{ background: noteBackground(note.colour) }}
              onClick={() => nav.go('notes', { kind: 'note', id: note.id })}
            >
              {note.pinned ? <span className="recent-pin" aria-label="Pinned">📌</span> : null}
              {note.title ? <strong>{note.title}</strong> : null}
              <span className="recent-body">{note.body || (note.title ? '' : 'Empty note')}</span>
              {note.checklist ? (
                <span className="muted small">
                  {note.checklist.done}/{note.checklist.total} done
                </span>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      <section className="cards">
        <div className="card">
          <span className="stat-label">Spent this month</span>
          <strong className="stat-value hero">
            {data ? (
              <>
                {data.month.total.figure}
                <span className="unit">{data.month.total.currency}</span>
              </>
            ) : (
              '—'
            )}
          </strong>
          <span className="stat-note">
            {data?.month.transactionCount ?? 0} transaction
            {data?.month.transactionCount === 1 ? '' : 's'}
          </span>
          {data && data.month.unvaluedCount > 0 ? (
            // Said out loud rather than folded into the figure above: those
            // charges have no known value, and counting them as zero would make
            // the total quietly wrong.
            <span className="stat-note warn">{data.month.unvaluedCount} awaiting statement</span>
          ) : null}
        </div>

        <div className="card">
          <span className="stat-label">Projected by month end</span>
          <strong className="stat-value hero">
            {data ? (
              <>
                {data.forecast.projectedTotal.figure}
                <span className="unit">{data.forecast.projectedTotal.currency}</span>
              </>
            ) : (
              '—'
            )}
          </strong>
          {data ? (
            <>
              <span className="stat-note">
                {data.forecast.committed.figure} already scheduled ·{' '}
                {data.forecast.daysRemaining} day
                {data.forecast.daysRemaining === 1 ? '' : 's'} left
              </span>
              {data.forecast.variableUnreliable ? (
                // The projection rests on too few days that actually had
                // spending. One sitting of back-dated entries looks like a
                // furious daily rate, so this is a hint, not a number.
                <span className="stat-note warn">
                  Based on {data.forecast.daysWithSpending} day
                  {data.forecast.daysWithSpending === 1 ? '' : 's'} of spending — treat the
                  everyday part as a rough hint
                </span>
              ) : (
                <span className="stat-note">
                  {data.forecast.dailyAverage.figure} a day so far
                </span>
              )}
              {data.forecast.rulesWithoutRate > 0 ? (
                <span className="stat-note warn">
                  {data.forecast.rulesWithoutRate} rule
                  {data.forecast.rulesWithoutRate === 1 ? '' : 's'} with no known rate — this
                  is a floor
                </span>
              ) : null}
            </>
          ) : null}
        </div>

        <button className="card card-link" onClick={() => nav.go('accounts')}>
          <span className="stat-label">In your accounts</span>
          {accounts.data && accounts.data.totals.length > 0 ? (
            accounts.data.totals.map((total, index) => (
              <strong key={total.currency} className={`stat-value ${index === 0 ? '' : 'secondary-figure'}`}>
                {total.figure}
                <span className="unit">{total.currency}</span>
              </strong>
            ))
          ) : (
            <strong className="stat-value">—</strong>
          )}
          <span className="stat-note">
            {accounts.data?.accounts.length
              ? `${accounts.data.accounts.length} account${accounts.data.accounts.length === 1 ? '' : 's'}, as last checked`
              : 'Add your bank, cash and cards'}
          </span>
        </button>

        <button className="card card-link" onClick={() => nav.go('debts')}>
          <span className="stat-label">Owed</span>
          <strong className="stat-value">{data?.openBalances.length ?? 0}</strong>
          <span className="stat-note">open balances</span>
        </button>

        <div className="card">
          <span className="stat-label">Needs attention</span>
          <strong
            className={`stat-value ${
              (data?.expiringDocuments.length ?? 0) + (data?.overdueNotes.length ?? 0) > 0
                ? 'owing'
                : ''
            }`}
          >
            {(data?.expiringDocuments.length ?? 0) + (data?.overdueNotes.length ?? 0)}
          </strong>
          <span className="stat-note">expiring documents and overdue notes</span>
        </div>
      </section>

      {data && data.allowance.configured ? <Allowance data={data.allowance} /> : null}

      {data && data.budgets.length > 0 ? (
        <>
          <h3>Budgets</h3>
          <ul className="list">
            {data.budgets.map((budget) => (
              <Budget key={budget.categoryId} budget={budget} />
            ))}
          </ul>
        </>
      ) : null}

      {data && data.pendingReminders.length > 0 ? (
        <>
          <h3>Due, not logged</h3>
          <ul className="list">
            {data.pendingReminders.map((charge) => (
              <li key={`${charge.ruleId}:${charge.date}`}>
                <span className="warn">{charge.name}</span>
                <span className="right">
                  {charge.amount.display}
                  <em className="muted"> {charge.date}</em>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data && data.upcoming.length > 0 ? (
        <>
          <h3>Coming up</h3>
          <ul className="list">
            {data.upcoming.map((charge) => (
              <li key={`${charge.ruleId}:${charge.date}`}>
                <span>{charge.name}</span>
                <span className="right">
                  {charge.amount.display}
                  <em className="muted"> {charge.date}</em>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data && (data.expiringDocuments.length > 0 || data.overdueNotes.length > 0) ? (
        <>
          <h3>Attention</h3>
          <ul className="list">
            {data.expiringDocuments.map((document) => (
              <li
                key={document.id}
                className="clickable"
                onClick={() => nav.go('documents', { kind: 'document', id: document.id })}
              >
                <span>{document.title}</span>
                <span className="right warn">expires {document.expiryDate}</span>
              </li>
            ))}
            {data.overdueNotes.map((note) => (
              <li key={note.id} className="clickable" onClick={() => nav.go('notes', { kind: 'note', id: note.id })}>
                <span>{note.title || note.body.split('\n')[0]}</span>
                <span className="right warn">due {note.dueOn}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="muted small">
        {data?.eventCount ?? 0} changes recorded on this device.
      </p>

      {configuring ? <AllowanceConfig onClose={() => setConfiguring(false)} /> : null}
    </>
  );
}

function Budget({ budget }: { budget: BudgetDto }) {
  const percent = Math.min(100, Math.round((budget.ratioUsed ?? 0) * 100));

  return (
    <li>
      <span className="grow">
        {budget.name}
        <div className="bar">
          <div
            className={budget.overspent ? 'fill over' : 'fill'}
            style={{ width: `${percent}%` }}
          />
        </div>
        {budget.carriedIn.amountMinor > 0 ? (
          <em className="muted small">{budget.carriedIn.figure} carried in</em>
        ) : null}
      </span>
      <span className="right">
        {budget.spent.figure} / {budget.available.display}
        <br />
        <em className={budget.overspent ? 'warn' : 'muted'}>
          {budget.overspent
            ? `${budget.remaining.figure.replace('−', '')} over`
            : `${budget.remaining.figure} left`}
        </em>
      </span>
    </li>
  );
}

function Allowance({ data }: { data: AllowanceDto }) {
  return (
    <>
      <h3>Foreign allowance — {data.label}</h3>
      <div className="cards">
        <div className="card">
          <span className="stat-label">Used</span>
          <strong className="figure">
            {data.used.figure} / {data.ceiling.display}
          </strong>
          <span className="stat-note">{data.remaining.figure} remaining</span>
          {data.unvaluedCount > 0 ? (
            // The used figure skips these rather than counting them as zero,
            // so it is a floor, and saying so is the difference between a
            // number and a misleading one.
            <span className="stat-note warn">
              {data.unvaluedCount} charge{data.unvaluedCount === 1 ? '' : 's'} with no
              debited value yet — used is a floor
            </span>
          ) : null}
        </div>
        <div className="card">
          <span className="stat-label">Projected</span>
          <strong className={`figure ${data.projectedOverrun.amountMinor > 0 ? 'owing' : ''}`}>
            {data.projectedTotal.display}
          </strong>
          {data.projectedOverrun.amountMinor > 0 ? (
            <span className="warn small">{data.projectedOverrun.figure} over the ceiling</span>
          ) : (
            <span className="muted small">{data.committedTotal.figure} still scheduled</span>
          )}
          {data.exhaustionDate ? (
            // The date the card starts being declined, which is worth knowing
            // well before it happens.
            <span className="warn small">Runs out {data.exhaustionDate}</span>
          ) : null}
          {data.rulesWithoutRate > 0 ? (
            <span className="warn small">
              {data.rulesWithoutRate} rule
              {data.rulesWithoutRate === 1 ? '' : 's'} with no known rate — a floor
            </span>
          ) : null}
        </div>
      </div>

      {data.byCurrency.length > 0 ? (
        <ul className="list">
          {data.byCurrency.map((usage) => (
            <li key={usage.currency}>
              <span>
                {usage.currency}
                <em className="muted">
                  {' '}
                  · {usage.transactionCount} charge
                  {usage.transactionCount === 1 ? '' : 's'}
                  {usage.unvaluedCount > 0 && usage.unvaluedCount < usage.transactionCount
                    ? `, ${usage.unvaluedCount} not yet valued`
                    : ''}
                </em>
              </span>
              <span className="right">
                {usage.billed.figure} {usage.currency}
                {usage.charged ? (
                  <em className="muted">
                    {' '}
                    → {usage.charged.display}
                  </em>
                ) : (
                  <em className="warn"> awaiting statement</em>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AllowanceConfig({ onClose }: { onClose: () => void }) {
  const existing = useVaultQuery(() => api().readAllowanceConfig());
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<AllowanceConfigDto | null>(null);

  const state = form ?? existing.data;
  if (!state) return null;

  return (
    <Modal
      title="Foreign currency allowance"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api().saveAllowanceConfig(state);
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Annual ceiling">
          <input
            value={state.ceiling}
            onChange={(event) => setForm({ ...state, ceiling: event.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Currency">
          <select
            value={state.currency}
            onChange={(event) => setForm({ ...state, currency: event.target.value })}
          >
            {currencies.data?.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year starts in month">
          <input
            type="number"
            min={1}
            max={12}
            value={state.yearStartMonth}
            onChange={(event) =>
              setForm({
                ...state,
                yearStartMonth: Math.min(12, Math.max(1, Number(event.target.value) || 1)),
              })
            }
          />
        </Field>
      </div>

      <p className="muted small">
        The ceiling is what the card may be debited over the allowance year, in the card&apos;s
        billing currency. Leave it empty to turn the tracking off.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
