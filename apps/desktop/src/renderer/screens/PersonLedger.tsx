/**
 * One person's ledger.
 *
 * Principal and interest are shown apart. A single total hides which part was
 * agreed and which part accrued, and that is the part people argue about.
 */

import { useState } from 'react';

import type { DebtEntryFormDto, LedgerDto, SideBalanceDto } from '../../shared/api.js';
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
  const people = useVaultQuery(() => api().listPeople());
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();
  const [entry, setEntry] = useState<DebtEntryFormDto | null>(null);

  const person = people.data?.find((candidate) => candidate.id === personId);
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
            <button key={kind} className="secondary" onClick={() => setEntry(blank(kind))}>
              {KIND_LABELS[kind]}
            </button>
          ))}
        </>
      }
    >
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
                : `${data.owesYou ? 'owes you' : 'you owe'} ${data.net.text.replace('-', '')} ${data.net.currency}`}
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
              {item.amount.text} {item.amount.currency}
              <em className="muted"> {item.occurredOn}</em>
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

      {entry ? (
        <EntryForm
          form={entry}
          currencies={(currencies.data ?? []).map((currency) => currency.code)}
          onClose={() => setEntry(null)}
        />
      ) : null}
    </Modal>
  );
}

function Side({ title, side }: { title: string; side: SideBalanceDto }) {
  if (side.total.amountMinor === 0 && side.loans.length === 0) return null;

  return (
    <div className="side">
      <span className="muted small">{title}</span>
      <span>
        {side.total.text} {side.total.currency}
        {side.interest.amountMinor !== 0 ? (
          <em className="muted small">
            {' '}
            ({side.principal.text} principal + {side.interest.text} interest)
          </em>
        ) : null}
      </span>
      {side.unapplied.amountMinor !== 0 ? (
        <span className="muted small">
          {side.unapplied.text} paid beyond what was owed, held as credit
        </span>
      ) : null}
      {side.loans.map((loan) => (
        <span key={loan.id} className="muted small">
          {loan.occurredOn}: {loan.total.text}
          {loan.interestTerms ? ` — ${loan.interestTerms}` : ''}
          {loan.closed ? ' — closed' : ''}
        </span>
      ))}
    </div>
  );
}

function EntryForm({
  form,
  currencies,
  onClose,
}: {
  form: DebtEntryFormDto;
  currencies: readonly string[];
  onClose: () => void;
}) {
  const [state, setState] = useState(form);
  const { busy, error, run } = useRunner();
  const isLoan = state.kind === 'lend' || state.kind === 'borrow';

  return (
    <Modal
      title={KIND_LABELS[state.kind]}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || state.amount.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().addDebtEntry(state);
                onClose();
              })
            }
          >
            Record
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
