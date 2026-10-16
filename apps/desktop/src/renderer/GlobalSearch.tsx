/**
 * One box over everything, above every screen.
 *
 * Search used to be a place you went to; now it is where you already are.
 * Ctrl+K (or "/" when no field has the cursor) puts the cursor in it, results
 * appear as you type, and choosing one opens the thing itself — the note in its
 * editor, the person's ledger — rather than a list that only names it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { SearchResultDto } from '../shared/api.js';
import { useNav, type Intent } from './nav.js';
import type { ScreenId } from './Sidebar.js';
import { api, messageOf } from './vault.js';

const ORDER: readonly SearchResultDto['kind'][] = ['person', 'note', 'expense', 'debt', 'account', 'document'];

const LABELS: Record<SearchResultDto['kind'], string> = {
  person: 'People',
  note: 'Notes',
  expense: 'Expenses',
  debt: 'Debts',
  account: 'Accounts',
  document: 'Documents',
};

/** Where a result lives, and what to open there. */
function destination(result: SearchResultDto): { screen: ScreenId; intent: Intent } | null {
  switch (result.kind) {
    case 'note':
      return { screen: 'notes', intent: { kind: 'note', id: result.id } };
    case 'expense':
      return { screen: 'expenses', intent: { kind: 'expense', id: result.id } };
    case 'person':
      return { screen: 'debts', intent: { kind: 'person', id: result.id } };
    case 'debt':
      return result.parentId ? { screen: 'debts', intent: { kind: 'person', id: result.parentId } } : null;
    case 'account':
      return { screen: 'accounts', intent: { kind: 'account', id: result.id } };
    case 'document':
      return { screen: 'documents', intent: { kind: 'document', id: result.id } };
  }
}

export function GlobalSearch() {
  const nav = useNav();
  const input = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResultDto[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ctrl+K anywhere; "/" only when the cursor is not already in a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
      if ((event.ctrlKey && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // As you type, a moment after the last key.
  useEffect(() => {
    const wanted = term.trim();
    if (wanted === '') {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api()
        .search(wanted)
        .then((found) => {
          if (!live) return;
          setResults(found);
          setActive(0);
          setError(null);
        })
        .catch((caught: unknown) => live && setError(messageOf(caught)));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  // Flattened in display order, so the arrow keys walk what is on screen.
  const ordered = useMemo(
    () => ORDER.flatMap((kind) => results.filter((result) => result.kind === kind)),
    [results],
  );

  function choose(result: SearchResultDto) {
    const target = destination(result);
    if (!target) return;
    nav.go(target.screen, target.intent);
    setOpen(false);
    setTerm('');
    input.current?.blur();
  }

  const showing = open && term.trim() !== '';

  return (
    <div className="gsearch">
      <input
        ref={input}
        type="search"
        value={term}
        placeholder="Search everything…  Ctrl+K"
        aria-label="Search everything"
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Late enough that a click on a result lands first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, ordered.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && ordered[active]) {
            event.preventDefault();
            choose(ordered[active]!);
          } else if (event.key === 'Escape') {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />

      {showing ? (
        <div className="gsearch-results" role="listbox">
          {error ? <p className="error small">{error}</p> : null}
          {!error && ordered.length === 0 ? <p className="muted small">Nothing matches that.</p> : null}
          {ORDER.map((kind) => {
            const group = ordered.filter((result) => result.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} className="gsearch-group">
                <div className="gsearch-kind">{LABELS[kind]}</div>
                {group.map((result) => {
                  const index = ordered.indexOf(result);
                  return (
                    <button
                      key={`${result.kind}:${result.id}`}
                      role="option"
                      aria-selected={index === active}
                      className={`gsearch-row ${index === active ? 'active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      // mousedown, not click: it fires before the input's blur.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(result);
                      }}
                    >
                      <span className="gsearch-title">
                        {result.title}
                        {result.detail ? <em className="muted"> · {result.detail}</em> : null}
                      </span>
                      <span className="gsearch-meta">
                        {result.amount ? `${result.amount.text} ${result.amount.currency}` : (result.date ?? '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
