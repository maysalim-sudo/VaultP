/** One box over everything in the vault. */

import { useState } from 'react';

import { api, useVaultQuery } from '../vault.js';

const KIND_LABELS = {
  expense: 'Expense',
  debt: 'Debt',
  document: 'Document',
  note: 'Note',
} as const;

export function Search() {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const results = useVaultQuery(() => api().search(submitted), submitted !== '');

  return (
    <>
      <div className="head">
        <h2>Search</h2>
      </div>

      <div className="row">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Expenses, people, documents, notes"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') setSubmitted(term.trim());
          }}
        />
        <button onClick={() => setSubmitted(term.trim())}>Search</button>
      </div>

      {results.error ? <p className="error">{results.error}</p> : null}

      {submitted !== '' && results.data?.length === 0 ? (
        <p className="muted small">Nothing matches that.</p>
      ) : null}

      <ul className="list">
        {results.data?.map((result) => (
          <li key={`${result.kind}:${result.id}`}>
            <span>
              <em className="muted small">{KIND_LABELS[result.kind]}</em>
              <br />
              {result.title}
              {result.detail ? <em className="muted"> · {result.detail}</em> : null}
            </span>
            <span className="right">
              {result.amount ? `${result.amount.text} ${result.amount.currency}` : null}
              {result.date ? <em className="muted"> {result.date}</em> : null}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
