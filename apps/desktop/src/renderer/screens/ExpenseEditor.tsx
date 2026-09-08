/**
 * One expense, in full.
 *
 * The debited field only appears for a foreign charge, because for a charge in
 * the base currency there is nothing to convert and asking would invite someone
 * to type the same number twice.
 */

import { useState } from 'react';

import type { CategoryDto, CurrencyDto, ExpenseDto, ExpenseFormDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, baseCurrency, useRunner } from '../vault.js';

function formOf(expense: ExpenseDto | undefined, today: string): ExpenseFormDto {
  if (!expense) {
    return {
      occurredOn: today,
      amount: '',
      currency: baseCurrency(),
      charged: '',
      merchant: '',
      note: '',
      categoryId: null,
    };
  }

  return {
    occurredOn: expense.occurredOn,
    amount: expense.amount.text,
    currency: expense.amount.currency,
    // An estimate is left blank rather than offered for confirmation: showing a
    // derived figure in the field where a statement goes is how a guess gets
    // saved as a fact.
    charged: expense.base && !expense.baseEstimated ? expense.base.text : '',
    merchant: expense.merchant ?? '',
    note: expense.note ?? '',
    categoryId: expense.categoryId,
  };
}

export function ExpenseEditor({
  expense,
  categories,
  currencies,
  today,
  onClose,
}: {
  expense: ExpenseDto | undefined;
  categories: readonly CategoryDto[];
  currencies: readonly CurrencyDto[];
  today: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ExpenseFormDto>(() => formOf(expense, today));
  const { busy, error, run } = useRunner();

  const set = <K extends keyof ExpenseFormDto>(key: K, value: ExpenseFormDto[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const foreign = form.currency !== baseCurrency();

  const save = () =>
    void run(async () => {
      if (expense) await api().updateExpense(expense.id, form);
      else await api().addExpense(form);
      onClose();
    });

  const remove = () =>
    void run(async () => {
      if (!expense) return;
      await api().deleteExpense(expense.id);
      onClose();
    });

  return (
    <Modal
      title={expense ? 'Edit expense' : 'New expense'}
      onClose={onClose}
      footer={
        <>
          {expense ? (
            <button className="danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button disabled={busy || form.amount.trim() === ''} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Amount">
          <input
            value={form.amount}
            onChange={(event) => set('amount', event.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>
        <Field label="Currency">
          <select
            value={form.currency}
            onChange={(event) => set('currency', event.target.value)}
          >
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {foreign ? (
        <Field label={`Debited (${baseCurrency()}) — leave blank until the statement arrives`}>
          <input
            value={form.charged}
            onChange={(event) => set('charged', event.target.value)}
            placeholder="not yet known"
          />
        </Field>
      ) : null}

      <div className="row">
        <Field label="Date">
          <input
            type="date"
            value={form.occurredOn}
            onChange={(event) => set('occurredOn', event.target.value)}
          />
        </Field>
        <Field label="Category">
          <select
            value={form.categoryId ?? ''}
            onChange={(event) => set('categoryId', event.target.value || null)}
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Merchant">
        <input
          value={form.merchant}
          onChange={(event) => set('merchant', event.target.value)}
          placeholder="Where"
        />
      </Field>

      <Field label="Note">
        <input
          value={form.note}
          onChange={(event) => set('note', event.target.value)}
          placeholder="Anything worth remembering"
        />
      </Field>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
