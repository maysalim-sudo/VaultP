/** Who owes what, and the entries behind it. */

import { useState } from 'react';

import type { BalanceDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, useRunner, useVaultQuery } from '../vault.js';
import { PersonLedger } from './PersonLedger.js';

export function Debts() {
  const balances = useVaultQuery(() => api().listBalances());
  const people = useVaultQuery(() => api().listPeople());
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const balanceOf = (personId: string): BalanceDto | undefined =>
    balances.data?.find((balance) => balance.id === personId);

  return (
    <>
      <div className="head">
        <h2>Debts</h2>
        <button onClick={() => setAdding(true)}>Add a person</button>
      </div>

      {people.data?.length === 0 ? (
        <p className="muted small">Nobody here yet.</p>
      ) : null}

      <ul className="list">
        {people.data?.map((person) => {
          const balance = balanceOf(person.id);
          return (
            <li key={person.id} className="clickable" onClick={() => setOpen(person.id)}>
              <span>
                {person.name}
                {person.contact ? <em className="muted"> · {person.contact}</em> : null}
              </span>
              <span className="right">{summarise(balance)}</span>
            </li>
          );
        })}
      </ul>

      {adding ? <AddPerson onClose={() => setAdding(false)} /> : null}
      {open ? <PersonLedger personId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function summarise(balance: BalanceDto | undefined) {
  if (!balance) return <em className="muted">settled</em>;
  if (balance.net === null) return <em className="warn">mixed currencies</em>;

  // Direction in words, not a sign: "-200" reads as either the moment you stop
  // concentrating.
  return (
    <span className={balance.owesYou ? 'owed' : 'owing'}>
      {balance.owesYou ? 'owes you ' : 'you owe '}
      {balance.net.text.replace('-', '')} {balance.net.currency}
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
