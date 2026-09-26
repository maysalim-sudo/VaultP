/**
 * Note colours.
 *
 * The upgrade test is the one that matters. A colour written by a newer build on
 * the other device arrives here before this device has a column for it, so it is
 * parked in `_extra`. Once the column exists, the repository reads the column —
 * and without the migration's promotion step the note would silently lose the
 * colour someone chose on their other device.
 */

import { describe, expect, it } from 'vitest';

import { categoryColourFor, noteShades } from '../design/tokens.js';
import { migrate } from '../db/migrations.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import {
  NOTE_COLOURS,
  NoteRepository,
  NoteValidationError,
  type NoteColour,
} from './repository.js';

function newNotes() {
  const store = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
  return new NoteRepository(store);
}

describe('note colours', () => {
  it('stores a colour and reads it back', () => {
    const notes = newNotes();
    const note = notes.addNote({ body: 'Renew the passport', colour: 'yellow' });

    expect(notes.getNote(note.id)?.colour).toBe('yellow');
  });

  it('defaults to no colour', () => {
    const notes = newNotes();
    expect(notes.addNote({ body: 'Plain' }).colour).toBeNull();
  });

  it('changes and clears a colour', () => {
    const notes = newNotes();
    const note = notes.addNote({ body: 'Groceries', colour: 'green' });

    expect(notes.updateNote(note.id, { colour: 'teal' }).colour).toBe('teal');
    // Back to the default card, not left on the previous colour.
    expect(notes.updateNote(note.id, { colour: null }).colour).toBeNull();
  });

  it('leaves the colour alone when an edit does not mention it', () => {
    const notes = newNotes();
    const note = notes.addNote({ body: 'Call the bank', colour: 'red' });

    expect(notes.updateNote(note.id, { body: 'Call the bank about the card' }).colour).toBe(
      'red',
    );
  });

  it('rejects a colour that is not in the set', () => {
    const notes = newNotes();
    expect(() => notes.addNote({ body: 'x', colour: 'magenta' as NoteColour })).toThrow(
      NoteValidationError,
    );
  });
});

describe('upgrading to a build that knows about colours', () => {
  it('keeps a colour that a newer device synced here before the upgrade', () => {
    const db = openTestDatabase();

    // The database exactly as the previous release left it: no colour column.
    migrate(db, 5);

    // What this device did on receiving a newer build's note: a field it had no
    // column for, parked in _extra rather than dropped.
    db.run(
      `INSERT INTO note (id, body, pinned, _meta, _extra) VALUES (?, ?, ?, ?, ?)`,
      [
        'n1',
        'Renew the passport',
        0,
        JSON.stringify({ body: 'hlc-1', pinned: 'hlc-1', colour: 'hlc-2' }),
        JSON.stringify({ colour: 'teal' }),
      ],
    );

    // Upgrade: opening the store runs the new migration.
    const store = VaultStore.open({ db, device: 'dev_phone' });
    const note = new NoteRepository(store).getNote('n1');

    expect(note?.colour).toBe('teal');
    expect(note?.body).toBe('Renew the passport');

    // And the value now lives in its column, not in both places.
    const raw = db.get<{ _extra: string }>(`SELECT _extra FROM note WHERE id = 'n1'`);
    expect(JSON.parse(raw!._extra)).not.toHaveProperty('colour');
  });

  it('shows an unknown colour from a newer build as the default card', () => {
    const notes = newNotes();
    const note = notes.addNote({ body: 'From the future' });

    // A colour this build does not know, as a newer one might write.
    (notes as unknown as { store: VaultStore }).store.database.run(
      `UPDATE note SET colour = 'ultraviolet' WHERE id = ?`,
      [note.id],
    );

    expect(notes.getNote(note.id)?.colour).toBeNull();
  });
});

describe('the design tokens behind note and category colours', () => {
  it('has a shade for every note colour, in both themes', () => {
    // A name notes accept but the theme cannot draw would render as a blank card.
    for (const scheme of ['light', 'dark'] as const) {
      for (const colour of NOTE_COLOURS) {
        expect(noteShades[scheme][colour], `${scheme}/${colour}`).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('gives a category the same colour every time', () => {
    expect(categoryColourFor('cat_groceries')).toBe(categoryColourFor('cat_groceries'));
  });

  it('prefers a colour the user chose', () => {
    expect(categoryColourFor('cat_groceries', '#123456')).toBe('#123456');
    // Anything that is not a colour is ignored rather than drawn.
    expect(categoryColourFor('cat_groceries', 'blue')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
