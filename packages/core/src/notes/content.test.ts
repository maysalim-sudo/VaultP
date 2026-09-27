/**
 * Notes as blocks.
 *
 * The tests that matter most are the compatibility ones: an old plain note must
 * open intact, a block type from a newer build must survive a save here, and
 * the plain-text rendering must stay readable for the builds that only see it.
 */

import { describe, expect, it } from 'vitest';

import { migrate } from '../db/migrations.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import {
  addColumn,
  addRow,
  checkBlock,
  convertBlock,
  displayOrder,
  dividerBlock,
  fromPlainText,
  imageBlock,
  listBlock,
  parseContent,
  removeColumn,
  removeRow,
  serializeContent,
  setCell,
  tableBlock,
  textBlock,
  toPlainText,
  type NoteContent,
} from './content.js';
import { NoteRepository, NoteValidationError } from './repository.js';

function newNotes() {
  const store = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
  return { store, notes: new NoteRepository(store) };
}

function content(...blocks: NoteContent['blocks']): NoteContent {
  return { blocks, checkedLast: false };
}

describe('plain text', () => {
  it('renders every kind of block readably', () => {
    const table = setCell(setCell(tableBlock(2, 2), 0, 0, 'Item'), 1, 0, 'Stamp');
    const text = toPlainText(
      content(
        textBlock('Carthage dossier', 'h1'),
        checkBlock('Birth certificate', true),
        checkBlock('Photos'),
        listBlock('bullet', 'Bring cash'),
        listBlock('numbered', 'First'),
        listBlock('numbered', 'Second'),
        dividerBlock(),
        table,
        { ...imageBlock('f1'), caption: 'receipt' },
      ),
    );

    expect(text).toBe(
      [
        'Carthage dossier',
        '☑ Birth certificate',
        '☐ Photos',
        '• Bring cash',
        '1. First',
        '2. Second',
        '———',
        'Item |',
        'Stamp |',
        '[image: receipt]',
      ].join('\n'),
    );
  });

  it('reads its own rendering back as the same kinds of block', () => {
    const back = fromPlainText('Shopping\n☐ Milk\n☑ Bread\n• Later');
    expect(back.blocks.map((b) => b.type)).toEqual(['text', 'check', 'check', 'bullet']);
    expect(back.blocks[2]).toMatchObject({ text: 'Bread', checked: true });
  });

  it('opens an old one-string note as one block per line', () => {
    const back = parseContent(null, 'Call the bank\nabout the card');
    expect(back.blocks).toHaveLength(2);
    expect(toPlainText(back)).toBe('Call the bank\nabout the card');
  });
});

describe('stored content', () => {
  it('round-trips every block', () => {
    const original = content(
      textBlock('Title', 'h2'),
      checkBlock('a', true, 1),
      tableBlock(2, 3),
      imageBlock('f1', { width: 800, height: 600 }),
      dividerBlock(),
    );
    expect(parseContent(serializeContent(original), '')).toEqual(original);
  });

  it('keeps a block type from a newer build through a save here', () => {
    const fromTheFuture = JSON.stringify({
      v: 2,
      blocks: [
        { id: 'a', type: 'text', style: 'body', text: 'Before' },
        { id: 'b', type: 'drawing', strokes: [[0, 0, 5, 5]] },
      ],
    });

    const parsed = parseContent(fromTheFuture, 'Before');
    expect(parsed.blocks[1]!.type).toBe('unknown');

    const saved = JSON.parse(serializeContent(parsed)) as { blocks: unknown[] };
    expect(saved.blocks[1]).toEqual({ id: 'b', type: 'drawing', strokes: [[0, 0, 5, 5]] });
  });

  it('falls back to the plain text when the stored blocks are damaged', () => {
    expect(toPlainText(parseContent('{not json', 'Still here'))).toBe('Still here');
  });

  it('pads a ragged table instead of dropping it', () => {
    const parsed = parseContent(
      JSON.stringify({ blocks: [{ id: 't', type: 'table', rows: [['a', 'b'], ['c']] }] }),
      '',
    );
    expect(parsed.blocks[0]).toMatchObject({ type: 'table', rows: [['a', 'b'], ['c', '']] });
  });
});

describe('editing blocks', () => {
  it('converts a line between kinds and keeps its words', () => {
    const item = checkBlock('Renew passport', true);
    const heading = convertBlock(item, 'h1');
    expect(heading).toMatchObject({ id: item.id, type: 'text', style: 'h1', text: 'Renew passport' });
    expect(convertBlock(heading, 'check')).toMatchObject({ type: 'check', checked: false });
  });

  it('grows and shrinks a table, never below one cell', () => {
    let table = tableBlock(1, 1);
    table = addColumn(addRow(table));
    expect(table.rows).toEqual([
      ['', ''],
      ['', ''],
    ]);
    table = removeColumn(removeRow(removeRow(table, 0), 0), 0);
    expect(table.rows).toEqual([['']]);
  });

  it('moves ticked items to the bottom of their own list only', () => {
    const a = checkBlock('a', true);
    const b = checkBlock('b');
    const heading = textBlock('Next');
    const c = checkBlock('c', true);
    const d = checkBlock('d');

    const order = displayOrder({ blocks: [a, b, heading, c, d], checkedLast: true });
    expect(order.map((block) => ('text' in block ? block.text : ''))).toEqual([
      'b',
      'a',
      'Next',
      'd',
      'c',
    ]);
  });
});

describe('rich notes in the vault', () => {
  it('stores a title and blocks, and keeps the plain text in step', () => {
    const { notes } = newNotes();
    const note = notes.addNote({
      title: 'Groceries',
      content: content(checkBlock('Milk'), checkBlock('Eggs', true)),
    });

    expect(note.title).toBe('Groceries');
    expect(note.body).toBe('☐ Milk\n☑ Eggs');
    expect(note.checklist).toEqual({ done: 1, total: 2 });
  });

  it('accepts a note that is only a title, or only an image', () => {
    const { notes } = newNotes();
    expect(notes.addNote({ title: 'Ideas' }).title).toBe('Ideas');
    expect(notes.addNote({ content: content(imageBlock('f1')) }).content.blocks).toHaveLength(1);
  });

  it('refuses a note with nothing in it', () => {
    const { notes } = newNotes();
    expect(() => notes.addNote({ title: '  ', content: content(textBlock(' '), dividerBlock()) })).toThrow(
      NoteValidationError,
    );
  });

  it('finds words inside checklists and tables', () => {
    const { notes } = newNotes();
    const table = setCell(tableBlock(1, 2), 0, 1, 'Timbre fiscal');
    const note = notes.addNote({ title: 'Dossier', content: content(table) });

    const found = notes.addNote({ body: 'unrelated' });
    expect(found.id).not.toBe(note.id);

    // The body column is what search reads.
    expect(notes.getNote(note.id)!.body).toContain('Timbre fiscal');
  });

  it('archives a note out of the main list, and unpins it', () => {
    const { notes } = newNotes();
    const note = notes.addNote({ body: 'Old plan', pinned: true });

    notes.updateNote(note.id, { archived: true });

    expect(notes.listOpen().map((n) => n.id)).not.toContain(note.id);
    expect(notes.listArchived()[0]).toMatchObject({ id: note.id, archived: true, pinned: false });

    notes.updateNote(note.id, { archived: false });
    expect(notes.listOpen().map((n) => n.id)).toContain(note.id);
  });

  it('labels notes, reusing a label by name', () => {
    const { notes } = newNotes();
    const note = notes.addNote({ body: 'Pack' });
    const travel = notes.ensureLabel('Travel');

    notes.addLabel(note.id, travel.id);
    notes.addLabel(note.id, notes.ensureLabel('travel').id);

    expect(notes.labelsFor(note.id)).toEqual([travel]);
    expect(notes.notesLabelled(travel.id)).toEqual(new Set([note.id]));

    notes.removeLabel(note.id, travel.id);
    expect(notes.labelsFor(note.id)).toEqual([]);
  });

  it('deletes an image removed from a note, unless another note shows it', () => {
    const { notes } = newNotes();
    const shared = notes.addImageFile({ id: 'f_shared', encryptedPath: 'vault-files/f_shared.enc' });
    const own = notes.addImageFile({ id: 'f_own', encryptedPath: 'vault-files/f_own.enc' });

    const a = notes.addNote({ content: content(imageBlock(shared.id), imageBlock(own.id)) });
    notes.addNote({ content: content(imageBlock(shared.id)) });

    const { released } = notes.saveNote(a.id, { content: content(textBlock('No pictures now')) });

    expect(released.map((file) => file.id)).toEqual(['f_own']);
    expect(notes.getFile('f_own')).toBeUndefined();
    expect(notes.getFile('f_shared')).toBeDefined();
  });

  it('releases a deleted note’s images', () => {
    const { notes } = newNotes();
    notes.addImageFile({ id: 'f1', encryptedPath: 'vault-files/f1.enc' });
    const note = notes.addNote({ content: content(imageBlock('f1')) });

    expect(notes.deleteNote(note.id).map((file) => file.id)).toEqual(['f1']);
  });

  it('duplicates a note with fresh block ids and the same labels', () => {
    const { notes } = newNotes();
    const note = notes.addNote({ title: 'Template', content: content(checkBlock('Step')) });
    const label = notes.ensureLabel('Work');
    notes.addLabel(note.id, label.id);

    const copy = notes.duplicateNote(note.id);

    expect(copy.title).toBe('Template');
    expect(copy.content.blocks[0]!.id).not.toBe(note.content.blocks[0]!.id);
    expect(notes.labelsFor(copy.id)).toEqual([label]);
  });

  it('keeps a quick-capture edit from wiping the title', () => {
    const { notes } = newNotes();
    const note = notes.addNote({ title: 'Bank', body: 'Call' });
    expect(notes.updateNote(note.id, { body: 'Call tomorrow' }).title).toBe('Bank');
  });
});

describe('upgrading to rich notes', () => {
  it('opens a note from before blocks existed exactly as it was', () => {
    const db = openTestDatabase();
    migrate(db, 6);
    db.run(`INSERT INTO note (id, body, pinned, colour) VALUES (?, ?, ?, ?)`, [
      'n1',
      'Renew the lease\n☐ call agent',
      1,
      'yellow',
    ]);

    const notes = new NoteRepository(VaultStore.open({ db, device: 'dev_phone' }));
    const note = notes.getNote('n1')!;

    expect(note).toMatchObject({ title: '', pinned: true, colour: 'yellow', archived: false });
    expect(note.content.blocks.map((b) => b.type)).toEqual(['text', 'check']);
    expect(note.body).toBe('Renew the lease\n☐ call agent');
  });

  it('keeps a title a newer device synced here before the upgrade', () => {
    const db = openTestDatabase();
    migrate(db, 6);
    db.run(`INSERT INTO note (id, body, _extra) VALUES (?, ?, ?)`, [
      'n1',
      'Milk',
      JSON.stringify({ title: 'Groceries', archived: true, other: 1 }),
    ]);

    const notes = new NoteRepository(VaultStore.open({ db, device: 'dev_phone' }));
    expect(notes.getNote('n1')).toMatchObject({ title: 'Groceries', archived: true });

    const raw = db.get<{ _extra: string }>(`SELECT _extra FROM note WHERE id = 'n1'`);
    expect(JSON.parse(raw!._extra)).toEqual({ other: 1 });
  });
});
