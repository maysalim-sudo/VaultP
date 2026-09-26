/**
 * Notes and to-dos, which are the same thing with different fields filled in.
 *
 * The original spec asked for two independent switches, and that is right: a due
 * date and a notification are different wants. "Renew the lease in March" is a
 * date you want to see in a list, not an interruption. "Call the bank tomorrow"
 * is an interruption. A single "remind me" setting forces one behaviour on both.
 *
 * So `dueOn` and `notify` are separate, and either can be set without the other.
 */

import { uuidv7 } from '../id.js';
import type { VaultStore } from '../db/store.js';
import type { Json } from '../oplog/event.js';
import { type IsoDate, compareDates, parseDate } from '../time/date.js';

/**
 * The colours a note can be, by name.
 *
 * Names, not hex values: each theme maps a name to its own shade, so a note
 * coloured on a light phone still reads on a dark desktop. The set is closed on
 * write — an unknown name is rejected — but tolerant on read, so a colour added
 * by a newer build shows as the default here rather than breaking the list.
 */
export const NOTE_COLOURS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'brown',
  'grey',
] as const;

export type NoteColour = (typeof NOTE_COLOURS)[number];

export function isNoteColour(value: unknown): value is NoteColour {
  return typeof value === 'string' && (NOTE_COLOURS as readonly string[]).includes(value);
}

export interface Note {
  readonly id: string;
  readonly body: string;
  readonly dueOn: IsoDate | null;
  /** Whether the due date should interrupt. Meaningless without a due date. */
  readonly notify: boolean;
  readonly done: boolean;
  readonly doneAt: string | null;
  readonly pinned: boolean;
  /** Null is the default, uncoloured card. */
  readonly colour: NoteColour | null;
}

export class NoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteValidationError';
  }
}

interface NoteRow {
  id: string;
  body: string | null;
  due_on: string | null;
  notify: number | null;
  done: number | null;
  done_at: string | null;
  pinned: number | null;
  colour: string | null;
}

function assertColour(colour: NoteColour | null | undefined): void {
  if (colour === undefined || colour === null) return;
  if (!isNoteColour(colour)) {
    throw new NoteValidationError(`Not a note colour: "${String(colour)}".`);
  }
}

export class NoteRepository {
  constructor(private readonly store: VaultStore) {}

  addNote(input: {
    body: string;
    dueOn?: IsoDate;
    notify?: boolean;
    pinned?: boolean;
    colour?: NoteColour | null;
    id?: string;
  }): Note {
    if (input.body.trim() === '') {
      throw new NoteValidationError('A note needs something written in it.');
    }
    if (input.dueOn) parseDate(input.dueOn);
    assertColour(input.colour);

    const id = input.id ?? uuidv7();
    this.store.commit('note', id, {
      body: input.body.trim(),
      due_on: input.dueOn ?? null,
      notify: input.notify ?? false,
      done: false,
      done_at: null,
      pinned: input.pinned ?? false,
      colour: input.colour ?? null,
    });
    return this.getNote(id)!;
  }

  updateNote(
    id: string,
    patch: {
      body?: string;
      dueOn?: IsoDate | null;
      notify?: boolean;
      pinned?: boolean;
      /** Null clears it back to the default card. */
      colour?: NoteColour | null;
    },
  ): Note {
    const fields: Record<string, Json> = {};

    if (patch.body !== undefined) {
      if (patch.body.trim() === '') {
        throw new NoteValidationError('A note needs something written in it.');
      }
      fields.body = patch.body.trim();
    }
    if (patch.dueOn !== undefined) {
      if (patch.dueOn !== null) parseDate(patch.dueOn);
      fields.due_on = patch.dueOn;
      // A notification with nothing to fire on is a setting that does nothing;
      // clearing it with the date keeps the two consistent.
      if (patch.dueOn === null) fields.notify = false;
    }
    if (patch.notify !== undefined) fields.notify = patch.notify;
    if (patch.pinned !== undefined) fields.pinned = patch.pinned;
    if (patch.colour !== undefined) {
      assertColour(patch.colour);
      fields.colour = patch.colour;
    }

    if (Object.keys(fields).length > 0) this.store.commit('note', id, fields);
    return this.getNote(id)!;
  }

  /**
   * Tick or untick.
   *
   * `doneAt` records when, because "I did this weeks ago" and "I did this this
   * morning" are different facts, and the list can order by it.
   */
  setDone(id: string, done: boolean, at: string = new Date().toISOString()): Note {
    this.store.commit('note', id, { done, done_at: done ? at : null });
    return this.getNote(id)!;
  }

  deleteNote(id: string): void {
    this.store.remove('note', id);
  }

  getNote(id: string): Note | undefined {
    const row = this.store.database.get<NoteRow>(
      'SELECT * FROM note WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toNote(row) : undefined;
  }

  /**
   * Open notes, most urgent first.
   *
   * Pinned, then dated soonest-first, then undated. A note with a date is asking
   * for attention on that date; one without is a thought being kept.
   */
  listOpen(): Note[] {
    return this.store.database
      .all<NoteRow>(
        `SELECT * FROM note
          WHERE deleted_at IS NULL AND (done IS NULL OR done = 0)
          ORDER BY pinned DESC,
                   CASE WHEN due_on IS NULL THEN 1 ELSE 0 END,
                   due_on ASC,
                   id DESC`,
      )
      .map(toNote);
  }

  listDone(limit = 50): Note[] {
    return this.store.database
      .all<NoteRow>(
        `SELECT * FROM note
          WHERE deleted_at IS NULL AND done = 1
          ORDER BY done_at DESC
          LIMIT ?`,
        [limit],
      )
      .map(toNote);
  }

  /** Notes due on or before `asOf` and not yet ticked off. */
  overdue(asOf: IsoDate): Note[] {
    return this.listOpen().filter(
      (note) => note.dueOn !== null && compareDates(note.dueOn, asOf) <= 0,
    );
  }

  /** Notes wanting a notification, for the scheduler. */
  notifiable(): Note[] {
    return this.listOpen().filter((note) => note.notify && note.dueOn !== null);
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    body: row.body ?? '',
    dueOn: row.due_on,
    notify: row.notify === 1,
    done: row.done === 1,
    doneAt: row.done_at,
    pinned: row.pinned === 1,
    colour: isNoteColour(row.colour) ? row.colour : null,
  };
}
