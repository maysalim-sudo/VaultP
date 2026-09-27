/**
 * Folders and hand-arranged order.
 *
 * Dragging a note between two others must write that one note and nothing
 * else — two devices reordering offline would otherwise fight over every
 * position in the list.
 */

import { describe, expect, it } from 'vitest';

import { migrate } from '../db/migrations.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { NoteRepository, NoteValidationError } from './repository.js';

function newNotes() {
  const store = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
  return { store, notes: new NoteRepository(store) };
}

/** Distinct creation times, since a never-dragged note sorts by age. */
function addInOrder(notes: NoteRepository, ...bodies: string[]) {
  return bodies.map((body, index) => {
    const note = notes.addNote({ body });
    notes['store'].database.run(`UPDATE note SET created_at = ? WHERE id = ?`, [
      new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
      note.id,
    ]);
    return note.id;
  });
}

const bodies = (notes: NoteRepository, folderId?: string | null) =>
  notes.listArranged(folderId).map((note) => note.body);

describe('arranged order', () => {
  it('puts the newest note on top until something is dragged', () => {
    const { notes } = newNotes();
    addInOrder(notes, 'first', 'second', 'third');
    expect(bodies(notes)).toEqual(['third', 'second', 'first']);
  });

  it('places a dragged note between its new neighbours, writing only that note', () => {
    const { notes, store } = newNotes();
    const [first, second, third] = addInOrder(notes, 'first', 'second', 'third');
    const eventsBefore = store.database.get<{ n: number }>('SELECT COUNT(*) AS n FROM oplog')!.n;

    // Drag "first" (bottom) between "third" and "second".
    notes.placeNote(first!, third!, second!);

    expect(bodies(notes)).toEqual(['third', 'first', 'second']);
    expect(store.database.get<{ n: number }>('SELECT COUNT(*) AS n FROM oplog')!.n).toBe(eventsBefore + 1);
  });

  it('moves a note to either end', () => {
    const { notes } = newNotes();
    const [first, , third] = addInOrder(notes, 'first', 'second', 'third');

    notes.placeNote(third!, first!, null);
    expect(bodies(notes)).toEqual(['second', 'first', 'third']);

    notes.placeNote(third!, null, notes.listArranged()[0]!.id);
    expect(bodies(notes)).toEqual(['third', 'second', 'first']);
  });

  it('pins a note dropped among the pinned ones', () => {
    const { notes } = newNotes();
    const [loose] = addInOrder(notes, 'loose');
    const pinned = notes.addNote({ body: 'pinned', pinned: true });

    notes.placeNote(loose!, pinned.id, null, true);

    expect(notes.getNote(loose!)!.pinned).toBe(true);
    expect(bodies(notes)).toEqual(['pinned', 'loose']);
  });

  it('keeps the urgency order for the places asking what needs doing', () => {
    const { notes } = newNotes();
    const [later] = addInOrder(notes, 'later');
    notes.updateNote(later!, { dueOn: '2027-01-01' });
    const soon = notes.addNote({ body: 'soon', dueOn: '2026-10-01' });

    notes.placeNote(soon.id, later!, null);

    expect(notes.listOpen().map((n) => n.body)).toEqual(['soon', 'later']);
    expect(bodies(notes)).toEqual(['later', 'soon']);
  });
});

describe('folders', () => {
  it('files notes into folders and lists a folder on its own', () => {
    const { notes } = newNotes();
    const work = notes.addFolder('Work');
    const [a, b] = addInOrder(notes, 'report', 'groceries');

    notes.moveToFolder(a!, work.id);

    expect(bodies(notes, work.id)).toEqual(['report']);
    expect(bodies(notes, null)).toEqual(['groceries']);
    expect(bodies(notes)).toHaveLength(2);
    expect(notes.getNote(b!)!.folderId).toBeNull();
  });

  it('keeps folders in the order they were made', () => {
    const { notes } = newNotes();
    notes.addFolder('Zeta');
    notes.addFolder('Alpha');
    expect(notes.listFolders().map((f) => f.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('keeps the notes when a folder is deleted', () => {
    const { notes } = newNotes();
    const trip = notes.addFolder('Trip');
    const note = notes.addNote({ body: 'Passport', folderId: trip.id });

    notes.deleteFolder(trip.id);

    expect(notes.listFolders()).toEqual([]);
    expect(notes.getNote(note.id)).toMatchObject({ body: 'Passport', folderId: null });
  });

  it('renames, and refuses an empty name or a folder that is gone', () => {
    const { notes } = newNotes();
    const folder = notes.addFolder('Wrk');
    expect(notes.renameFolder(folder.id, ' Work ').name).toBe('Work');
    expect(() => notes.addFolder('  ')).toThrow(NoteValidationError);

    const note = notes.addNote({ body: 'x' });
    notes.deleteFolder(folder.id);
    expect(() => notes.moveToFolder(note.id, folder.id)).toThrow(NoteValidationError);
  });

  it('copies a note into the same folder', () => {
    const { notes } = newNotes();
    const folder = notes.addFolder('Templates');
    const note = notes.addNote({ body: 'Checklist', folderId: folder.id });
    expect(notes.duplicateNote(note.id).folderId).toBe(folder.id);
  });
});

describe('upgrading to folders', () => {
  it('keeps a folder a newer device assigned before the upgrade', () => {
    const db = openTestDatabase();
    migrate(db, 7);
    db.run(`INSERT INTO note (id, body, _extra) VALUES (?, ?, ?)`, [
      'n1',
      'Filed elsewhere',
      JSON.stringify({ folder_id: 'f1', position: 2.5 }),
    ]);

    const notes = new NoteRepository(VaultStore.open({ db, device: 'dev_phone' }));
    expect(notes.getNote('n1')).toMatchObject({ folderId: 'f1', position: 2.5 });
  });
});
