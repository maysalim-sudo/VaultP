/**
 * One person's ledger.
 *
 * Principal and interest are shown apart. A single total hides which part was
 * agreed and which part accrued, and that is the part people argue about.
 */

import { useState } from 'react';

import type { DebtEntryDto, DebtEntryFormDto, PersonDto, SideBalanceDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';

const KIND_LABELS: Record<DebtEntryFormDto['kind'], string> = {
  lend: 'I lent them',
  borrow: 'They lent me',
  repaidToMe: 'They paid me back',
  repaidByMe: 'I paid them back',
};

export function PersonLedger({
  personId,
  onClose,
}: {
  personId: string;
  onClose: () => void;
}) {
  const ledger = useVaultQuery(() => api().ledgerFor(personId));
  // By id rather than from the list, which leaves out archived people.
  const personQuery = useVaultQuery(() => api().getPerson(personId));
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();
  const [entry, setEntry] = useState<{ form: DebtEntryFormDto; replaces?: string } | null>(null);
  const [editingPerson, setEditingPerson] = useState(false);

  const person = personQuery.data ?? undefined;
  const data = ledger.data;

  const blank = (kind: DebtEntryFormDto['kind']): DebtEntryFormDto => ({
    personId,
    kind,
    amount: '',
    currency: baseCurrency(),
    occurredOn: data?.asOf ?? '',
    note: '',
    interest: { method: 'none', ratePercent: '', period: 'monthly' },
  });

  return (
    <Modal
      title={person?.name ?? 'Ledger'}
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            disabled={busy || !data || data.net.amountMinor === 0}
            onClick={() =>
              void run(async () => {
                await api().settleDebt(personId, '');
              })
            }
          >
            Settle up
          </button>
          <span className="spacer" />
          {(Object.keys(KIND_LABELS) as DebtEntryFormDto['kind'][]).map((kind) => (
            <button key={kind} className="secondary" onClick={() => setEntry({ form: blank(kind) })}>
              {KIND_LABELS[kind]}
            </button>
          ))}
        </>
      }
    >
      {person ? (
        <div className="row person-head">
          <span className="muted small">
            {[person.contact, person.note].filter(Boolean).join(' · ') || 'No contact or note'}
            {person.archived ? ' · archived' : ''}
          </span>
          <span className="spacer" />
          <button className="secondary" onClick={() => setEditingPerson(true)}>
            Edit details
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(() => (person.archived ? api().unarchivePerson(person.id) : api().archivePerson(person.id)))
            }
          >
            {person.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      ) : null}

      {ledger.error ? <p className="error">{ledger.error}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {data?.mixedCurrencies ? (
        <p className="warn small">{data.mixedCurrencies}</p>
      ) : data ? (
        <>
          <div className="net">
            <span className="muted small">As of {data.asOf}</span>
            <strong className={`figure ${data.owesYou ? 'owed' : 'owing'}`}>
              {data.net.amountMinor === 0
                ? 'Settled'
                : `${data.owesYou ? 'owes you' : 'you owe'} ${data.net.figure.replace('−', '')} ${data.net.currency}`}
            </strong>
          </div>

          <Side title="They owe you" side={data.owedToMe} />
          <Side title="You owe them" side={data.owedByMe} />
        </>
      ) : null}

      <h3>Entries</h3>
      <ul className="list">
        {data?.entries.map((item) => (
          <li key={item.id}>
            <span>
              {item.kind}
              <em className="muted"> · {item.owedToMe ? 'owed to you' : 'owed by you'}</em>
              {item.note ? <em className="muted"> · {item.note}</em> : null}
            </span>
            <span className="right">
              {item.amount.display}
              <em className="muted"> {item.occurredOn}</em>
              {correctionOf(item) ? (
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => setEntry({ form: { ...blank(correctionOf(item)!), ...prefill(item) }, replaces: item.id })}
                >
                  correct
                </button>
              ) : null}
              {item.kind === 'adjustment' ? null : (
                <button
                  className="link"
                  disabled={busy}
                  onClick={() =>
                    // Voided, not deleted: the ledger keeps showing that
                    // something was corrected, which is what makes it evidence.
                    void run(() => api().voidDebtEntry(item.id, 'Voided on the desktop'))
                  }
                >
                  void
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {data?.entries.length === 0 ? <p className="muted small">Nothing recorded.</p> : null}

      {editingPerson && person ? <EditPerson person={person} onClose={() => setEditingPerson(false)} /> : null}

      {entry ? (
        <EntryForm
          form={entry.form}
          replaces={entry.replaces}
          currencies={(currencies.data ?? []).map((currency) => currency.code)}
          onClose={() => setEntry(null)}
        />
      ) : null}
    </Modal>
  );
}

/**
 * Which form re-records this entry. Entries are never edited in place — the
 * ledger is evidence — so a correction voids the original and records the
 * right one, and both stay visible.
 */
function correctionOf(item: DebtEntryDto): DebtEntryFormDto['kind'] | null {
  if (item.kind === 'loan') return item.owedToMe ? 'lend' : 'borrow';
  if (item.kind === 'payment') return item.owedToMe ? 'repaidToMe' : 'repaidByMe';
  return null;
}

function prefill(item: DebtEntryDto): Partial<DebtEntryFormDto> {
  return {
    amount: item.amount.text.replace('-', ''),
    currency: item.amount.currency,
    occurredOn: item.occurredOn,
    note: item.note ?? '',
  };
}

function EditPerson({ person, onClose }: { person: PersonDto; onClose: () => void }) {
  const [name, setName] = useState(person.name);
  const [contact, setContact] = useState(person.contact ?? '');
  const [note, setNote] = useState(person.note ?? '');
  const { busy, error, run } = useRunner();

  return (
    <Modal
      title="Edit details"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || name.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().updatePerson(person.id, { name, contact, note });
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
      <Field label="Contact">
        <input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Phone, email, anything" />
      </Field>
      <Field label="Note">
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <p className="muted small">Their loans and repayments stay exactly as they are.</p>
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}

function Side({ title, side }: { title: string; side: SideBalanceDto }) {
  if (side.total.amountMinor === 0 && side.loans.length === 0) return null;

  return (
    <div className="side">
      <span className="muted small">{title}</span>
      <span>
        {side.total.display}
        {side.interest.amountMinor !== 0 ? (
          <em className="muted small">
            {' '}
            ({side.principal.figure} principal + {side.interest.figure} interest)
          </em>
        ) : null}
      </span>
      {side.unapplied.amountMinor !== 0 ? (
        <span className="muted small">
          {side.unapplied.figure} paid beyond what was owed, held as credit
        </span>
      ) : null}
      {side.loans.map((loan) => (
        <span key={loan.id} className="muted small">
          {loan.occurredOn}: {loan.total.figure}
          {loan.interestTerms ? ` — ${loan.interestTerms}` : ''}
          {loan.closed ? ' — closed' : ''}
        </span>
      ))}
    </div>
  );
}

function EntryForm({
  form,
  replaces,
  currencies,
  onClose,
}: {
  form: DebtEntryFormDto;
  /** Set when correcting: this entry is voided as the new one is recorded. */
  replaces?: string | undefined;
  currencies: readonly string[];
  onClose: () => void;
}) {
  const [state, setState] = useState(form);
  const { busy, error, run } = useRunner();
  const isLoan = state.kind === 'lend' || state.kind === 'borrow';

  return (
    <Modal
      title={replaces ? `Correct: ${KIND_LABELS[state.kind]}` : KIND_LABELS[state.kind]}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || state.amount.trim() === ''}
            onClick={() =>
              void run(async () => {
                // Recorded first, so a typo in the new amount leaves the old
                // entry standing rather than voided with nothing in its place.
                await api().addDebtEntry(state);
                if (replaces) await api().voidDebtEntry(replaces, 'Corrected');
                onClose();
              })
            }
          >
            {replaces ? 'Save correction' : 'Record'}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Amount">
          <input
            value={state.amount}
            onChange={(event) => setState({ ...state, amount: event.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Currency">
          <select
            value={state.currency}
            onChange={(event) => setState({ ...state, currency: event.target.value })}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={state.occurredOn}
            onChange={(event) => setState({ ...state, occurredOn: event.target.value })}
          />
        </Field>
      </div>

      {isLoan ? (
        <div className="row">
          <Field label="Interest">
            <select
              value={state.interest.method}
              onChange={(event) =>
                setState({
                  ...state,
                  interest: {
                    ...state.interest,
                    method: event.target.value as 'none' | 'simple' | 'compound',
                  },
                })
              }
            >
              <option value="none">None</option>
              <option value="simple">Simple</option>
              <option value="compound">Compound</option>
            </select>
          </Field>
          {state.interest.method === 'none' ? null : (
            <>
              <Field label="Rate % per period">
                <input
                  value={state.interest.ratePercent}
                  onChange={(event) =>
                    setState({
                      ...state,
                      interest: { ...state.interest, ratePercent: event.target.value },
                    })
                  }
                  placeholder="5"
                />
              </Field>
              <Field label="Period">
                <select
                  value={state.interest.period}
                  onChange={(event) =>
                    setState({
                      ...state,
                      interest: {
                        ...state.interest,
                        period: event.target.value as 'daily' | 'monthly' | 'yearly',
                      },
                    })
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>
            </>
          )}
        </div>
      ) : null}

      {isLoan && state.interest.method !== 'none' ? (
        <p className="muted small">
          The rate is per period, not annualised: 5% monthly is 5% each month.
        </p>
      ) : null}

      <Field label="Note">
        <input
          value={state.note}
          onChange={(event) => setState({ ...state, note: event.target.value })}
          placeholder="What it was for"
        />
      </Field>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
