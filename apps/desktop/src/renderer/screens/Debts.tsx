/** Who owes what, and the entries behind it. */

import { useState } from 'react';

import { formatAmount, money } from '@vaultp/core';

import type { BalanceDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { useIntent } from '../nav.js';
import { api, useRunner, useVaultQuery } from '../vault.js';
import { PersonLedger } from './PersonLedger.js';

export function Debts() {
  const balances = useVaultQuery(() => api().listBalances());
  const people = useVaultQuery(() => api().listPeople());
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const archived = useVaultQuery(() => api().listArchivedPeople(), showArchived);

  useIntent('debts', (intent) => {
    if (intent.kind === 'person') setOpen(intent.id);
    if (intent.kind === 'newPerson') setAdding(true);
  });

  const balanceOf = (personId: string): BalanceDto | undefined =>
    balances.data?.find((balance) => balance.id === personId);

  const side = (owesYou: boolean) => {
    const totals = new Map<string, number>();
    for (const balance of balances.data ?? []) {
      if (balance.owesYou !== owesYou || !balance.net) continue;
      totals.set(balance.net.currency, (totals.get(balance.net.currency) ?? 0) + Math.abs(balance.net.amountMinor));
    }
    const count = (balances.data ?? []).filter((balance) => balance.owesYou === owesYou && balance.net).length;
    const figure =
      totals.size === 0
        ? '0'
        : [...totals].map(([currency, minor]) => formatAmount(money(minor, currency), { unit: 'none' })).join(' + ');
    return { figure, count, unit: [...totals.keys()].join(' + ') };
  };
  const owed = side(true);
  const owing = side(false);

  return (
    <>
      <div className="head">
        <h2>People</h2>
        <button onClick={() => setAdding(true)}>Add a person</button>
      </div>

      <div className="split">
        <aside className="split-side">
          <div className="pair-tiles">
            <div className="tile">
              <span className="label">OWED TO YOU</span>
              <span className="dots pos">{owed.figure}</span>
              <span className="label">
                {owed.unit || 'TND'} · {owed.count} {owed.count === 1 ? 'PERSON' : 'PEOPLE'}
              </span>
            </div>
            <div className="tile">
              <span className="label">YOU OWE</span>
              <span className="dots neg">{owing.figure}</span>
              <span className="label">
                {owing.unit || 'TND'} · {owing.count} {owing.count === 1 ? 'PERSON' : 'PEOPLE'}
              </span>
            </div>
          </div>
          <p className="label" style={{ lineHeight: 1.7 }}>
            A LOAN AND EVERY REPAYMENT ARE SEPARATE ENTRIES. SETTLING KEEPS THE HISTORY.
          </p>
        </aside>

        <div className="split-main">
          {people.data?.length === 0 ? <div className="empty">Nobody here yet</div> : null}
          {people.data && people.data.length > 0 ? (
            <section className="tile" style={{ padding: '6px 20px 18px' }}>
              <div className="rows" style={{ marginTop: 0 }}>
                {people.data.map((person, index) => {
                  const balance = balanceOf(person.id);
                  return (
                    <button
                      key={person.id}
                      style={index === 0 ? { borderTop: 0 } : undefined}
                      onClick={() => setOpen(person.id)}
                    >
                      <span className="initials">{person.name.slice(0, 2).toUpperCase()}</span>
                      <span className="what">
                        <strong>{person.name}</strong>
                        <span>{person.contact ?? person.note ?? 'Open the ledger'}</span>
                      </span>
                      {summarise(balance)}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

      <p className="small">
        <button className="link" onClick={() => setShowArchived((current) => !current)}>
          {showArchived ? 'Hide archived people' : 'Show archived people'}
        </button>
      </p>
      {showArchived ? (
        archived.data && archived.data.length > 0 ? (
          <ul className="list">
            {archived.data.map((person) => (
              <li key={person.id} className="clickable" onClick={() => setOpen(person.id)}>
                <span>
                  {person.name} <em className="muted">· archived</em>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nobody is archived.</p>
        )
      ) : null}

        </div>
      </div>

      {adding ? <AddPerson onClose={() => setAdding(false)} /> : null}
      {open ? <PersonLedger personId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function summarise(balance: BalanceDto | undefined) {
  if (!balance) {
    return (
      <span className="amt">
        <span className="muted">—</span>
        <small>SETTLED</small>
      </span>
    );
  }
  if (balance.net === null) {
    return (
      <span className="amt">
        <span className="warn">mixed</span>
        <small>CURRENCIES</small>
      </span>
    );
  }

  // Direction in words, not only a sign: "-200" reads as either the moment you
  // stop concentrating.
  return (
    <span className="amt">
      <span className={balance.owesYou ? 'owed' : 'owing'}>
        {balance.owesYou ? '+' : '−'}
        {balance.net.figure.replace('−', '')}
      </span>
      <small>
        {balance.net.currency} · {balance.owesYou ? 'OWES YOU' : 'YOU OWE'}
      </small>
    </span>
  );
}

function AddPerson({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner();

  return (
    <Modal
      title="Add a person"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || name.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().addPerson({ name, contact, note });
                onClose();
              })
            }
          >
            Add
          </button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
      <Field label="Contact">
        <input
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="Phone, email, anything"
        />
      </Field>
      <Field label="Note">
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
