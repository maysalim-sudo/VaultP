/**
 * Accounts: where the money is, as last read.
 *
 * Each balance shows the day it was true, and goes quiet-warning once that day
 * is a month old — a figure is only as good as when it was looked at, and an
 * old one presented as current is how people get surprised by their bank.
 */

import { useState } from 'react';

import type { AccountDto, AccountFormDto, AccountKindDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { useIntent } from '../nav.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';

const KINDS: { value: AccountKindDto; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'savings', label: 'Savings' },
  { value: 'other', label: 'Other' },
];

const STALE_AFTER_DAYS = 30;

function daysSince(isoDate: string): number {
  const then = Date.parse(`${isoDate}T00:00:00`);
  return Number.isNaN(then) ? 0 : Math.floor((Date.now() - then) / 86_400_000);
}

export function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const data = useVaultQuery(() => api().listAccounts(showArchived));
  const [editing, setEditing] = useState<{ account: AccountDto | null } | null>(null);
  const { busy, error, run } = useRunner();

  useIntent('accounts', (intent) => {
    if (intent.kind === 'newAccount') setEditing({ account: null });
    if (intent.kind === 'account') {
      void api()
        .listAccounts(true)
        .then((all) => {
          const found = all.accounts.find((account) => account.id === intent.id);
          if (found) setEditing({ account: found });
        });
    }
  });

  const accounts = data.data?.accounts ?? [];
  const totals = data.data?.totals ?? [];

  return (
    <>
      <div className="head">
        <h2>Accounts</h2>
        <div className="row">
          <label className="row check small">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            <span>Show archived</span>
          </label>
          <button onClick={() => setEditing({ account: null })}>New account</button>
        </div>
      </div>

      {totals.length > 0 ? (
        <div className="cards">
          {totals.map((total) => (
            <div key={total.currency} className="card">
              <span className="stat-label">Across your accounts</span>
              <span className="stat-value">
                {total.text}
                <span className="unit">{total.currency}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {data.data && accounts.length === 0 ? (
        <div className="empty">
          <p>No accounts yet.</p>
          <p className="muted small">
            Add your bank, the cash in your wallet, a card or a savings pot, with the balance you see today. You type the
            balance in; nothing here is connected to a bank.
          </p>
        </div>
      ) : null}

      <ul className="list">
        {accounts.map((account) => {
          const age = daysSince(account.balanceOn);
          return (
            <li key={account.id} className="clickable" onClick={() => setEditing({ account })}>
              <span>
                {account.name}
                <em className="muted"> · {KINDS.find((kind) => kind.value === account.kind)?.label}</em>
                {account.archived ? <em className="muted"> · archived</em> : null}
                <br />
                <em className={`small ${age > STALE_AFTER_DAYS ? 'warn' : 'muted'}`}>
                  {age === 0 ? 'checked today' : `checked ${account.balanceOn}`}
                  {age > STALE_AFTER_DAYS ? ' — worth a fresh look' : ''}
                </em>
              </span>
              <span className="right">
                {account.balance.text} {account.balance.currency}
              </span>
            </li>
          );
        })}
      </ul>

      {error ? <p className="error">{error}</p> : null}

      {editing ? (
        <AccountEditor
          account={editing.account}
          busy={busy}
          onClose={() => setEditing(null)}
          onArchive={(account) =>
            void run(async () => {
              await api().setAccountArchived(account.id, !account.archived);
              setEditing(null);
            })
          }
          onDelete={(account) => {
            if (!window.confirm(`Delete ${account.name}? It disappears from every device.`)) return;
            void run(async () => {
              await api().deleteAccount(account.id);
              setEditing(null);
            });
          }}
        />
      ) : null}
    </>
  );
}

function AccountEditor({
  account,
  busy: outerBusy,
  onClose,
  onArchive,
  onDelete,
}: {
  account: AccountDto | null;
  busy: boolean;
  onClose: () => void;
  onArchive: (account: AccountDto) => void;
  onDelete: (account: AccountDto) => void;
}) {
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<AccountFormDto>({
    name: account?.name ?? '',
    kind: account?.kind ?? 'bank',
    balance: account?.balance.text ?? '',
    currency: account?.balance.currency ?? baseCurrency(),
    balanceOn: account?.balanceOn ?? '',
    note: account?.note ?? '',
  });

  const save = () =>
    void run(async () => {
      if (account) await api().updateAccount(account.id, form);
      else await api().addAccount(form);
      onClose();
    });

  return (
    <Modal
      title={account ? account.name || 'Account' : 'New account'}
      onClose={onClose}
      footer={
        <>
          {account ? (
            <>
              <button className="secondary" disabled={busy || outerBusy} onClick={() => onArchive(account)}>
                {account.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button className="danger" disabled={busy || outerBusy} onClick={() => onDelete(account)}>
                Delete
              </button>
            </>
          ) : null}
          <span className="spacer" />
          <button disabled={busy || form.name.trim() === ''} onClick={save}>
            {account ? 'Save' : 'Add account'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="BIAT current account, Wallet, Savings…"
          autoFocus
        />
      </Field>

      <Field label="Kind">
        <div className="row">
          {KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              className={`tag ${form.kind === kind.value ? 'on' : ''}`}
              onClick={() => setForm({ ...form, kind: kind.value })}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="row">
        <Field label="Balance">
          <input
            value={form.balance}
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, balance: event.target.value })}
            placeholder="0"
            onKeyDown={(event) => event.key === 'Enter' && save()}
          />
        </Field>
        <Field label="Currency">
          <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
            {(currencies.data ?? [{ code: form.currency, name: form.currency }]).map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="As of">
          <input
            type="date"
            value={form.balanceOn}
            onChange={(event) => setForm({ ...form, balanceOn: event.target.value })}
          />
        </Field>
      </div>
      <p className="muted small">
        A changed balance is dated today unless you pick another day. A negative balance — an overdrawn account, a card —
        is written with a minus.
      </p>

      <Field label="Note">
        <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      </Field>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
