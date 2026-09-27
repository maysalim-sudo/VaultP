/**
 * One search across everything.
 *
 * The point of putting four modules in one app is that you can look for "Sami"
 * and find the loan, the expense and the note without deciding first which of
 * them it was. Four separate searches merged in the UI would be four chances to
 * rank things inconsistently and four places to forget a field.
 *
 * A single SQL union rather than an FTS index: the corpus is one person's records
 * on a phone, LIKE over a few thousand rows is instant, and an index would be
 * another thing to keep in step with the event log for no measurable gain. When
 * that stops being true, this is the one function to change.
 */

import type { SqlDatabase, SqlValue } from './db/adapter.js';
import { BASE_CURRENCY, type CurrencyCode } from './money/currency.js';
import { type Money, money } from './money/money.js';
import { noteHeadline } from './notes/repository.js';
import type { IsoDate } from './time/date.js';

export type SearchResultKind = 'expense' | 'debt' | 'document' | 'note';

export interface SearchResult {
  readonly kind: SearchResultKind;
  readonly id: string;
  /** What to show as the heading. */
  readonly title: string;
  /** Secondary line: a date, a person, whatever identifies it. */
  readonly detail: string;
  readonly amount: Money | null;
  readonly date: IsoDate | null;
  /** For opening the right screen: the person a debt entry belongs to. */
  readonly parentId: string | null;
}

export interface SearchOptions {
  readonly limitPerKind?: number;
  readonly baseCurrency?: CurrencyCode;
}

export const DEFAULT_LIMIT_PER_KIND = 20;

/** Escape the wildcards, so searching for "%" finds a literal per-cent sign. */
function likePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
}

export function searchEverything(
  db: SqlDatabase,
  term: string,
  options: SearchOptions = {},
): SearchResult[] {
  const trimmed = term.trim();
  if (trimmed === '') return [];

  const limit = options.limitPerKind ?? DEFAULT_LIMIT_PER_KIND;
  const baseCurrency = options.baseCurrency ?? BASE_CURRENCY;
  const pattern = likePattern(trimmed);
  const results: SearchResult[] = [];

  // ------------------------------------------------------------- expenses
  const expenses = db.all<{
    id: string;
    occurred_on: string;
    amount_minor: number;
    currency: string | null;
    merchant: string | null;
    note: string | null;
    category: string | null;
  }>(
    `SELECT e.id, e.occurred_on, e.amount_minor, e.currency, e.merchant, e.note,
            c.name AS category
       FROM expense e
       LEFT JOIN category c ON c.id = e.category_id
      WHERE e.deleted_at IS NULL
        AND (e.merchant LIKE ? ESCAPE '\\' OR e.note LIKE ? ESCAPE '\\'
             OR c.name LIKE ? ESCAPE '\\')
      ORDER BY e.occurred_on DESC
      LIMIT ?`,
    [pattern, pattern, pattern, limit] as SqlValue[],
  );

  for (const row of expenses) {
    results.push({
      kind: 'expense',
      id: row.id,
      title: row.merchant ?? row.category ?? 'Expense',
      detail: [row.category, row.note].filter(Boolean).join(' · ') || row.occurred_on,
      amount: money(row.amount_minor, row.currency ?? baseCurrency),
      date: row.occurred_on,
      parentId: null,
    });
  }

  // ---------------------------------------------------------------- debts
  //
  // Matching the person's name as well as the entry, because "Sami" is how you
  // look for a loan, not by whatever was typed in the note field.
  const debts = db.all<{
    id: string;
    person_id: string;
    person: string | null;
    kind: string;
    amount_minor: number;
    currency: string | null;
    occurred_on: string;
    note: string | null;
  }>(
    `SELECT d.id, d.person_id, p.name AS person, d.kind, d.amount_minor,
            d.currency, d.occurred_on, d.note
       FROM debt_entry d
       LEFT JOIN person p ON p.id = d.person_id
      WHERE d.deleted_at IS NULL
        AND (p.name LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\')
      ORDER BY d.occurred_on DESC
      LIMIT ?`,
    [pattern, pattern, limit] as SqlValue[],
  );

  for (const row of debts) {
    results.push({
      kind: 'debt',
      id: row.id,
      title: row.person ?? 'Debt',
      detail: [row.kind, row.note].filter(Boolean).join(' · '),
      amount: money(row.amount_minor, row.currency ?? baseCurrency),
      date: row.occurred_on,
      parentId: row.person_id,
    });
  }

  // ------------------------------------------------------------ documents
  const documents = db.all<{
    id: string;
    title: string | null;
    expiry_date: string | null;
    note: string | null;
    extracted_text: string | null;
  }>(
    `SELECT id, title, expiry_date, note, extracted_text
       FROM document
      WHERE deleted_at IS NULL
        AND (title LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'
             OR extracted_text LIKE ? ESCAPE '\\')
      ORDER BY title COLLATE NOCASE
      LIMIT ?`,
    [pattern, pattern, pattern, limit] as SqlValue[],
  );

  for (const row of documents) {
    // Say where the match was, since matching on OCR text is the surprising and
    // useful case: the word is inside the scan, not in anything you typed.
    const inText =
      row.extracted_text !== null &&
      row.extracted_text.toLowerCase().includes(trimmed.toLowerCase()) &&
      !(row.title ?? '').toLowerCase().includes(trimmed.toLowerCase());

    results.push({
      kind: 'document',
      id: row.id,
      title: row.title ?? 'Document',
      detail: inText
        ? 'found in the document text'
        : row.expiry_date
          ? `expires ${row.expiry_date}`
          : (row.note ?? ''),
      amount: null,
      date: row.expiry_date,
      parentId: null,
    });
  }

  // ---------------------------------------------------------------- notes
  //
  // `body` is the plain-text rendering of the note's blocks, so this finds words
  // inside checklist items, table cells and image captions as well.
  const notes = db.all<{
    id: string;
    title: string | null;
    body: string | null;
    due_on: string | null;
    done: number | null;
    archived: number | null;
  }>(
    `SELECT id, title, body, due_on, done, archived
       FROM note
      WHERE deleted_at IS NULL
        AND (body LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
      ORDER BY done ASC, due_on ASC
      LIMIT ?`,
    [pattern, pattern, limit] as SqlValue[],
  );

  for (const row of notes) {
    results.push({
      kind: 'note',
      id: row.id,
      title: noteHeadline({ title: row.title ?? '', body: row.body ?? '' }, 120),
      detail:
        row.done === 1
          ? 'done'
          : row.archived === 1
            ? 'archived'
            : row.due_on
              ? `due ${row.due_on}`
              : 'note',
      amount: null,
      date: row.due_on,
      parentId: null,
    });
  }

  return results;
}

/** Grouped for display, in a fixed order so the screen never rearranges itself. */
export function groupResults(
  results: readonly SearchResult[],
): Array<{ kind: SearchResultKind; results: SearchResult[] }> {
  const order: SearchResultKind[] = ['expense', 'debt', 'document', 'note'];
  return order
    .map((kind) => ({ kind, results: results.filter((r) => r.kind === kind) }))
    .filter((group) => group.results.length > 0);
}
