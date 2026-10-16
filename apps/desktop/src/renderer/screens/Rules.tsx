/**
 * Recurring charges.
 *
 * A rule either logs itself or only reminds. Both are listed together, marked,
 * because "did that subscription get recorded?" is the question this screen
 * exists to answer.
 */

import { useState } from 'react';

import type { RuleDto, RuleFormDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export function Rules() {
  const rules = useVaultQuery(() => api().listRules());
  const pending = useVaultQuery(() => api().listPendingReminders());
  const upcoming = useVaultQuery(() => api().listUpcoming());
  const categories = useVaultQuery(() => api().listCategories());
  const { busy, error, run } = useRunner();
  const [editing, setEditing] = useState<{ rule: RuleDto | null } | null>(null);
  const [logged, setLogged] = useState<number | null>(null);

  const nameOf = (id: string | null) =>
    categories.data?.find((category) => category.id === id)?.name ?? 'Uncategorised';

  return (
    <>
      <div className="head">
        <h2>Recurring</h2>
        <div className="row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api().runAutoLog();
                setLogged(result.created);
              })
            }
          >
            Catch up auto-logged
          </button>
          <button onClick={() => setEditing({ rule: null })}>New rule</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {logged !== null ? (
        <p className="muted small">
          {logged === 0 ? 'Nothing was due.' : `${logged} charge${logged === 1 ? '' : 's'} logged.`}
        </p>
      ) : null}

      {pending.data && pending.data.length > 0 ? (
        <>
          <h3>Due, not logged</h3>
          <ul className="list">
            {pending.data.map((charge) => (
              <li key={`${charge.ruleId}:${charge.date}`}>
                <span className="warn">{charge.name}</span>
                <span className="right">
                  {charge.amount.text} {charge.amount.currency}
                  <em className="muted"> {charge.date}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            These rules only remind. Log them from the Expenses screen when they land.
          </p>
        </>
      ) : null}

      <h3>Rules</h3>
      <ul className="list">
        {rules.data?.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            categoryName={nameOf(rule.categoryId)}
            onEdit={() => setEditing({ rule })}
          />
        ))}
      </ul>
      {rules.data?.length === 0 ? <p className="muted small">No rules yet.</p> : null}

      {upcoming.data && upcoming.data.length > 0 ? (
        <>
          <h3>Next 30 days</h3>
          <ul className="list">
            {upcoming.data.map((charge) => (
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

      {editing ? <RuleForm rule={editing.rule} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RuleRow({ rule, categoryName, onEdit }: { rule: RuleDto; categoryName: string; onEdit: () => void }) {
  const { busy, run } = useRunner();
  const [amount, setAmount] = useState<string | null>(null);

  const every =
    rule.intervalN === 1 ? rule.frequency : `every ${rule.intervalN} ${rule.frequency}`;

  return (
    <li>
      <span>
        {rule.name}
        <em className="muted"> · {categoryName}</em>
        <br />
        <em className="muted small">
          {every}, from {rule.anchorDate} · {rule.autoLog ? 'logs itself' : 'reminds only'}
          {rule.state === 'active' ? '' : ` · ${rule.state}`}
        </em>
        {rule.priceChange ? (
          // A few dinars a month on a service you forgot about is exactly the
          // charge that never gets noticed on a statement.
          <>
            <br />
            <em className="warn small">
              price changed by {rule.priceChange.difference.text}{' '}
              {rule.priceChange.difference.currency}
            </em>
          </>
        ) : null}
      </span>

      <span className="right row">
        {amount === null ? (
          <>
            <span>
              {rule.amount.text} {rule.amount.currency}
            </span>
            <button className="link" onClick={() => setAmount(rule.amount.text)}>
              reprice
            </button>
          </>
        ) : (
          <>
            <input
              className="narrow"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api().updateRuleAmount(rule.id, amount, rule.amount.currency);
                  setAmount(null);
                })
              }
            >
              Save
            </button>
            <button className="secondary" onClick={() => setAmount(null)}>
              Cancel
            </button>
          </>
        )}

        <button
          className="link"
          disabled={busy}
          onClick={() =>
            void run(() =>
              api().setRuleState(rule.id, rule.state === 'active' ? 'paused' : 'active'),
            )
          }
        >
          {rule.state === 'active' ? 'pause' : 'resume'}
        </button>
        <button className="link" onClick={onEdit}>
          edit
        </button>
      </span>
    </li>
  );
}

function RuleForm({ rule, onClose }: { rule: RuleDto | null; onClose: () => void }) {
  const categories = useVaultQuery(() => api().listCategories());
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();

  const [form, setForm] = useState<RuleFormDto>({
    name: rule?.name ?? '',
    amount: rule?.amount.text ?? '',
    currency: rule?.amount.currency ?? baseCurrency(),
    categoryId: rule?.categoryId ?? null,
    frequency: rule?.frequency ?? 'monthly',
    intervalN: rule?.intervalN ?? 1,
    anchorDate: rule?.anchorDate ?? '',
    autoLog: rule?.autoLog ?? false,
  });

  const set = <K extends keyof RuleFormDto>(key: K, value: RuleFormDto[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      title={rule ? 'Edit recurring rule' : 'New recurring rule'}
      onClose={onClose}
      footer={
        <>
          {rule ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete ${rule.name}? Charges it already logged stay in your expenses.`)) return;
                void run(async () => {
                  await api().deleteRule(rule.id);
                  onClose();
                });
              }}
            >
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button
            disabled={busy || form.name.trim() === '' || form.amount.trim() === ''}
            onClick={() =>
              void run(async () => {
                if (rule) await api().updateRule(rule.id, form);
                else await api().addRule(form);
                onClose();
              })
            }
          >
            {rule ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          placeholder="Rent, Netflix, insurance"
          autoFocus
        />
      </Field>

      <div className="row">
        <Field label="Amount">
          <input value={form.amount} onChange={(event) => set('amount', event.target.value)} />
        </Field>
        <Field label="Currency">
          <select
            value={form.currency}
            onChange={(event) => set('currency', event.target.value)}
          >
            {currencies.data?.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={form.categoryId ?? ''}
            onChange={(event) => set('categoryId', event.target.value || null)}
          >
            <option value="">Uncategorised</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="Every">
          <input
            type="number"
            min={1}
            value={form.intervalN}
            onChange={(event) => set('intervalN', Math.max(1, Number(event.target.value) || 1))}
          />
        </Field>
        <Field label="Frequency">
          <select
            value={form.frequency}
            onChange={(event) => set('frequency', event.target.value as RuleFormDto['frequency'])}
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency}
              </option>
            ))}
          </select>
        </Field>
        <Field label="First occurrence">
          <input
            type="date"
            value={form.anchorDate}
            onChange={(event) => set('anchorDate', event.target.value)}
          />
        </Field>
      </div>

      <label className="row check">
        <input
          type="checkbox"
          checked={form.autoLog}
          onChange={(event) => set('autoLog', event.target.checked)}
        />
        <span>Log the charge automatically when it comes due</span>
      </label>

      <p className="muted small">
        An anchor in the past does not create charges for dates before today: the rule
        starts describing what happens from now on.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
