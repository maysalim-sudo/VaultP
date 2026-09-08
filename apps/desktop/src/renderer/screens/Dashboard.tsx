/** Where the month stands, and where it is heading. */

import { useState } from 'react';

import type { AllowanceConfigDto, AllowanceDto, BudgetDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

export function Dashboard() {
  const overview = useVaultQuery(() => api().overview());
  const [configuring, setConfiguring] = useState(false);
  const data = overview.data;

  return (
    <>
      <div className="head">
        <h2>Dashboard</h2>
        <button className="secondary" onClick={() => setConfiguring(true)}>
          Foreign allowance
        </button>
      </div>

      {overview.error ? <p className="error">{overview.error}</p> : null}

      <section className="cards">
        <div className="card">
          <span className="muted small">Spent this month</span>
          <strong className="figure">
            {data ? `${data.month.total.text} ${data.month.total.currency}` : '—'}
          </strong>
          <span className="muted small">
            {data?.month.transactionCount ?? 0} transaction
            {data?.month.transactionCount === 1 ? '' : 's'}
          </span>
          {data && data.month.unvaluedCount > 0 ? (
            // Said out loud rather than folded into the figure above: those
            // charges have no known value, and counting them as zero would make
            // the total quietly wrong.
            <span className="warn small">{data.month.unvaluedCount} awaiting statement</span>
          ) : null}
        </div>

        <div className="card">
          <span className="muted small">Projected by month end</span>
          <strong className="figure">
            {data ? `${data.forecast.projectedTotal.text} ${data.forecast.projectedTotal.currency}` : '—'}
          </strong>
          {data ? (
            <>
              <span className="muted small">
                {data.forecast.committed.text} already scheduled ·{' '}
                {data.forecast.daysRemaining} day
                {data.forecast.daysRemaining === 1 ? '' : 's'} left
              </span>
              {data.forecast.variableUnreliable ? (
                // The projection rests on too few days that actually had
                // spending. One sitting of back-dated entries looks like a
                // furious daily rate, so this is a hint, not a number.
                <span className="warn small">
                  Based on {data.forecast.daysWithSpending} day
                  {data.forecast.daysWithSpending === 1 ? '' : 's'} of spending — treat the
                  everyday part as a rough hint
                </span>
              ) : (
                <span className="muted small">
                  {data.forecast.dailyAverage.text} a day so far
                </span>
              )}
              {data.forecast.rulesWithoutRate > 0 ? (
                <span className="warn small">
                  {data.forecast.rulesWithoutRate} rule
                  {data.forecast.rulesWithoutRate === 1 ? '' : 's'} with no known rate — this
                  is a floor
                </span>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="card">
          <span className="muted small">Owed</span>
          <strong className="figure">{data?.openBalances.length ?? 0}</strong>
          <span className="muted small">open balances</span>
        </div>

        <div className="card">
          <span className="muted small">Needs attention</span>
          <strong
            className={`figure ${
              (data?.expiringDocuments.length ?? 0) + (data?.overdueNotes.length ?? 0) > 0
                ? 'warn'
                : ''
            }`}
          >
            {(data?.expiringDocuments.length ?? 0) + (data?.overdueNotes.length ?? 0)}
          </strong>
          <span className="muted small">expiring documents and overdue notes</span>
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
                  {charge.amount.text} {charge.amount.currency}
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
                  {charge.amount.text} {charge.amount.currency}
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
              <li key={document.id}>
                <span>{document.title}</span>
                <span className="right warn">expires {document.expiryDate}</span>
              </li>
            ))}
            {data.overdueNotes.map((note) => (
              <li key={note.id}>
                <span>{note.body}</span>
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
          <em className="muted small">{budget.carriedIn.text} carried in</em>
        ) : null}
      </span>
      <span className="right">
        {budget.spent.text} / {budget.available.text} {budget.available.currency}
        <br />
        <em className={budget.overspent ? 'warn' : 'muted'}>
          {budget.overspent
            ? `${budget.remaining.text.replace('-', '')} over`
            : `${budget.remaining.text} left`}
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
          <span className="muted small">Used</span>
          <strong className="figure">
            {data.used.text} / {data.ceiling.text} {data.ceiling.currency}
          </strong>
          <span className="muted small">{data.remaining.text} remaining</span>
          {data.unvaluedCount > 0 ? (
            // The used figure skips these rather than counting them as zero,
            // so it is a floor, and saying so is the difference between a
            // number and a misleading one.
            <span className="warn small">
              {data.unvaluedCount} charge{data.unvaluedCount === 1 ? '' : 's'} with no
              debited value yet — used is a floor
            </span>
          ) : null}
        </div>
        <div className="card">
          <span className="muted small">Projected</span>
          <strong className={`figure ${data.projectedOverrun.amountMinor > 0 ? 'warn' : ''}`}>
            {data.projectedTotal.text} {data.projectedTotal.currency}
          </strong>
          {data.projectedOverrun.amountMinor > 0 ? (
            <span className="warn small">{data.projectedOverrun.text} over the ceiling</span>
          ) : (
            <span className="muted small">{data.committedTotal.text} still scheduled</span>
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
                {usage.billed.text} {usage.currency}
                {usage.charged ? (
                  <em className="muted">
                    {' '}
                    → {usage.charged.text} {usage.charged.currency}
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
