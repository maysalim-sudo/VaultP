/**
 * One expense, in full.
 *
 * The debited field only appears for a foreign charge, because for a charge in
 * the base currency there is nothing to convert and asking would invite someone
 * to type the same number twice.
 */

import { useState } from 'react';

import { exponentOf, formatAmount, money, parseAmount, toDecimalString } from '@vaultp/core';

import type { CategoryDto, CurrencyDto, ExpenseDto, ExpenseFormDto } from '../../shared/api.js';
import { Icon, categoryIcon } from '../icons.js';
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

/** The amount as whole minor units, the way the keypad builds it. */
function minorOf(amount: string, currency: string): number {
  if (amount.trim() === '') return 0;
  try {
    return Math.abs(parseAmount(amount, currency).amountMinor);
  } catch {
    return 0;
  }
}

const MAX_MINOR = 9_999_999_999;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as const;

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
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const set = <K extends keyof ExpenseFormDto>(key: K, value: ExpenseFormDto[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const foreign = form.currency !== baseCurrency();

  // A card terminal's amount: digits fill in from the right, so the decimals
  // are always there and always as many as the currency has. Typed or pressed,
  // the same rule.
  const minor = minorOf(form.amount, form.currency);
  const setMinor = (next: number) => {
    const clamped = Math.max(0, Math.min(MAX_MINOR, next));
    set('amount', clamped === 0 ? '' : toDecimalString(money(clamped, form.currency)));
  };
  const press = (key: (typeof KEYS)[number]) => {
    if (key === '⌫') setMinor(Math.floor(minor / 10));
    else if (key === '00') setMinor(minor * 100);
    else setMinor(minor * 10 + Number(key));
  };
  const shown = formatAmount(money(minor, form.currency), { unit: 'none' });

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
          <button className="accent" disabled={busy || minor === 0} onClick={save}>
            Save {shown} {form.currency}
          </button>
        </>
      }
    >
      <section className="amount-tile">
        <div className="label-row">
          <span className="label">AMOUNT · {exponentOf(form.currency)} DECIMALS</span>
          <select
            aria-label="Currency"
            value={form.currency}
            onChange={(event) => set('currency', event.target.value)}
          >
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </div>
        <div
          className="amount-readout dots"
          role="textbox"
          aria-label={`Amount, ${shown} ${form.currency}. Type digits; Backspace removes one.`}
          tabIndex={0}
          autoFocus
          ref={(element) => {
            // A new expense starts with the cursor in the amount, like a till.
            if (element && !expense && document.activeElement === document.body) element.focus();
          }}
          onKeyDown={(event) => {
            if (/^[0-9]$/.test(event.key)) {
              event.preventDefault();
              press(event.key as (typeof KEYS)[number]);
            } else if (event.key === 'Backspace') {
              event.preventDefault();
              press('⌫');
            } else if (event.key === 'Delete') {
              event.preventDefault();
              setMinor(0);
            } else if (event.key === 'Enter' && minor > 0) {
              save();
            }
          }}
        >
          {shown}
        </div>
        {foreign ? (
          <label className="amount-debited">
            <span className="label">DEBITED IN {baseCurrency()}</span>
            <input
              value={form.charged}
              onChange={(event) => set('charged', event.target.value)}
              placeholder="Leave blank until the statement arrives"
            />
          </label>
        ) : null}
      </section>

      <div className="chips">
        {categories.map((category) => (
          <button
            key={category.id}
            className={`tag icon-tag ${form.categoryId === category.id ? 'on' : ''}`}
            onClick={() => set('categoryId', form.categoryId === category.id ? null : category.id)}
          >
            <Icon name={categoryIcon(category.name)} size={14} />
            {category.name}
          </button>
        ))}
        {/* Just made, and the list has not caught up yet. */}
        {created && !categories.some((c) => c.id === created.id) ? (
          <button className="tag icon-tag on">{created.name}</button>
        ) : null}
        <button className="tag" onClick={() => setAdding(true)}>
          + Other
        </button>
      </div>

      <div className="lined">
        <label>
          <span className="label">FOR</span>
          <input value={form.merchant} onChange={(event) => set('merchant', event.target.value)} placeholder="Where" />
        </label>
        <label>
          <span className="label">DATE</span>
          <input type="date" value={form.occurredOn} onChange={(event) => set('occurredOn', event.target.value)} />
        </label>
        <label>
          <span className="label">NOTE</span>
          <input
            value={form.note}
            onChange={(event) => set('note', event.target.value)}
            placeholder="Anything worth remembering"
          />
        </label>
      </div>

      <div className="keypad" aria-label="Keypad">
        {KEYS.map((key) => (
          <button key={key} aria-label={key === '⌫' ? 'Delete a digit' : `Digit ${key}`} onClick={() => press(key)}>
            {key}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {adding ? (
        <NewCategory
          categories={categories}
          onClose={() => setAdding(false)}
          onCreated={(category) => {
            setCreated(category);
            set('categoryId', category.id);
            setAdding(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

const ICONS = ['🛒', '🍽', '🚕', '🏠', '💊', '🎓', '🎁', '🐾', '✈️', '🔧', '👕', '📱'] as const;

/**
 * A small dialog for a category of your own. Saved with the others and chosen
 * at once; a name that already exists picks that one rather than a twin.
 */
function NewCategory({
  categories,
  onClose,
  onCreated,
}: {
  categories: readonly CategoryDto[];
  onClose: () => void;
  onCreated: (category: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const { busy, error, run } = useRunner();

  const trimmed = name.trim();
  const existing = categories.find((c) => trimmed !== '' && c.name.toLowerCase() === trimmed.toLowerCase());

  const save = () =>
    void run(async () => {
      if (trimmed === '') return;
      onCreated(await api().ensureCategory(trimmed, icon));
    });

  return (
    <Modal
      title="New category"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy || trimmed === ''} onClick={save}>
            {existing ? 'Use it' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          autoFocus
          value={name}
          maxLength={40}
          placeholder="Pets, Gifts, Pharmacy…"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
      </Field>
      {existing ? <p className="muted small">You already have “{existing.name}” — that one will be picked.</p> : null}
      <Field label="Icon (optional)">
        <div className="row tags">
          {ICONS.map((glyph) => (
            <button
              key={glyph}
              className={`tag ${icon === glyph ? 'on' : ''}`}
              onClick={() => setIcon(icon === glyph ? null : glyph)}
            >
              {glyph}
            </button>
          ))}
        </div>
      </Field>
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
