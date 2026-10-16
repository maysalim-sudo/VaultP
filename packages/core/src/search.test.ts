import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from './db/store.js';
import { openTestDatabase } from './db/testing/nodeSqlite.js';
import { DebtRepository } from './debts/repository.js';
import { DocumentRepository } from './documents/repository.js';
import { ExpenseRepository } from './expenses/repository.js';
import { parseAmount } from './money/money.js';
import { NoteRepository, NoteValidationError } from './notes/repository.js';
import { groupResults, searchEverything } from './search.js';

const tnd = (value: string) => parseAmount(value, 'TND');

function newVault() {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: 'dev_phone' });
  return {
    db,
    store,
    expenses: new ExpenseRepository(store),
    debts: new DebtRepository(store),
    documents: new DocumentRepository(store),
    notes: new NoteRepository(store),
  };
}

describe('notes', () => {
  let vault: ReturnType<typeof newVault>;

  beforeEach(() => {
    vault = newVault();
  });

  it('keeps a due date and a notification as separate choices', () => {
    // A date you want to see in a list, with no interruption.
    const quiet = vault.notes.addNote({ body: 'Renew the lease', dueOn: '2027-03-01' });
    expect(quiet.dueOn).toBe('2027-03-01');
    expect(quiet.notify).toBe(false);

    // And one that should interrupt.
    const loud = vault.notes.addNote({
      body: 'Call the bank',
      dueOn: '2026-09-10',
      notify: true,
    });
    expect(loud.notify).toBe(true);
  });

  it('keeps a plain note with no date at all', () => {
    const note = vault.notes.addNote({ body: 'Ideas for the trip' });
    expect(note.dueOn).toBeNull();
    expect(note.notify).toBe(false);
  });

  it('turns the notification off when the date is removed', () => {
    const note = vault.notes.addNote({
      body: 'Call the bank',
      dueOn: '2026-09-10',
      notify: true,
    });

    // A notification with nothing to fire on is a setting that does nothing.
    const updated = vault.notes.updateNote(note.id, { dueOn: null });
    expect(updated.notify).toBe(false);
  });

  it('records when something was ticked off', () => {
    const note = vault.notes.addNote({ body: 'Pay the bill' });
    const done = vault.notes.setDone(note.id, true, '2026-09-07T10:00:00.000Z');

    expect(done.done).toBe(true);
    expect(done.doneAt).toBe('2026-09-07T10:00:00.000Z');

    const undone = vault.notes.setDone(note.id, false);
    expect(undone.done).toBe(false);
    expect(undone.doneAt).toBeNull();
  });

  it('orders pinned first, then by date, then the undated', () => {
    vault.notes.addNote({ body: 'Someday' });
    vault.notes.addNote({ body: 'Later', dueOn: '2026-12-01' });
    vault.notes.addNote({ body: 'Soon', dueOn: '2026-09-10' });
    vault.notes.addNote({ body: 'Always', pinned: true });

    expect(vault.notes.listOpen().map((n) => n.body)).toEqual([
      'Always',
      'Soon',
      'Later',
      'Someday',
    ]);
  });

  it('separates open from done', () => {
    const note = vault.notes.addNote({ body: 'Pay the bill' });
    vault.notes.addNote({ body: 'Still to do' });
    vault.notes.setDone(note.id, true);

    expect(vault.notes.listOpen().map((n) => n.body)).toEqual(['Still to do']);
    expect(vault.notes.listDone().map((n) => n.body)).toEqual(['Pay the bill']);
  });

  it('lists what is overdue, and only what wants a notification', () => {
    vault.notes.addNote({ body: 'Overdue quiet', dueOn: '2026-09-01' });
    vault.notes.addNote({ body: 'Overdue loud', dueOn: '2026-09-02', notify: true });
    vault.notes.addNote({ body: 'Future', dueOn: '2027-01-01', notify: true });

    expect(vault.notes.overdue('2026-09-07').map((n) => n.body)).toEqual([
      'Overdue quiet',
      'Overdue loud',
    ]);
    expect(vault.notes.notifiable().map((n) => n.body)).toEqual([
      'Overdue loud',
      'Future',
    ]);
  });

  it('rejects an empty note', () => {
    expect(() => vault.notes.addNote({ body: '   ' })).toThrow(NoteValidationError);
  });
});

describe('global search', () => {
  let vault: ReturnType<typeof newVault>;

  beforeEach(() => {
    vault = newVault();
    vault.expenses.addCategory({ id: 'food', name: 'Food' });
    vault.expenses.addExpense({
      occurredOn: '2026-09-05',
      amount: tnd('45.000'),
      merchant: 'Dinner with Sami',
      categoryId: 'food',
    });
    vault.debts.addPerson({ id: 'p_sami', name: 'Sami' });
    vault.debts.lend({
      personId: 'p_sami',
      amount: tnd('200.000'),
      occurredOn: '2026-09-01',
    });
    vault.documents.addDocument({
      title: 'Passport',
      extractedText: 'REPUBLIQUE TUNISIENNE PASSEPORT 12345678 SAMI',
    });
    vault.notes.addNote({ body: 'Ask Sami about the car' });
  });

  it('finds one word across every module at once', () => {
    // The reason these live in one app: you look for a name, not for which
    // module you happened to file it under.
    const results = searchEverything(vault.db, 'Sami');
    expect(new Set(results.map((r) => r.kind))).toEqual(
      new Set(['person', 'expense', 'debt', 'document', 'note']),
    );
  });

  it('finds a debt by the person name, not just the note field', () => {
    const debt = searchEverything(vault.db, 'Sami').find((r) => r.kind === 'debt');
    expect(debt?.title).toBe('Sami');
    expect(debt?.parentId).toBe('p_sami');
  });

  it('finds a document by text inside the scan, and says so', () => {
    const found = searchEverything(vault.db, '12345678');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'document',
      title: 'Passport',
      detail: 'found in the document text',
    });
  });

  it('finds an expense by its category', () => {
    const found = searchEverything(vault.db, 'Food');
    expect(found.map((r) => r.kind)).toEqual(['expense']);
  });

  it('returns nothing for an empty search', () => {
    expect(searchEverything(vault.db, '   ')).toEqual([]);
  });

  it('treats wildcards as literal characters', () => {
    // Otherwise "%" would match every row in the vault.
    expect(searchEverything(vault.db, '%')).toEqual([]);
    expect(searchEverything(vault.db, '_')).toEqual([]);
  });

  it('omits deleted records', () => {
    const [expense] = vault.expenses.listExpenses();
    vault.expenses.deleteExpense(expense!.id);

    expect(searchEverything(vault.db, 'Sami').filter((r) => r.kind === 'expense')).toEqual(
      [],
    );
  });

  it('groups results in a fixed order', () => {
    const grouped = groupResults(searchEverything(vault.db, 'Sami'));
    expect(grouped.map((g) => g.kind)).toEqual(['person', 'note', 'expense', 'debt', 'document']);
  });

  it('finds the person themselves, so their ledger can be opened', () => {
    const people = searchEverything(vault.db, 'sami').filter((r) => r.kind === 'person');
    expect(people.map((r) => r.title)).toEqual(['Sami']);
  });

  it('caps how much each module can contribute', () => {
    for (let i = 0; i < 30; i++) {
      vault.notes.addNote({ body: `Sami note ${i}` });
    }

    const results = searchEverything(vault.db, 'Sami', { limitPerKind: 5 });
    expect(results.filter((r) => r.kind === 'note')).toHaveLength(5);
  });
});
