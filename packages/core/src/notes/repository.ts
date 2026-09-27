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
import type { StoredFile, Tag } from '../documents/repository.js';
import { taggingId } from '../documents/repository.js';
import type { Json } from '../oplog/event.js';
import { type IsoDate, compareDates, parseDate } from '../time/date.js';
import {
  type ChecklistProgress,
  type NoteContent,
  checklistProgress,
  fromPlainText,
  imageFileIds,
  isContentEmpty,
  parseContent,
  serializeContent,
  toPlainText,
} from './content.js';

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
  readonly title: string;
  /** The note itself, as blocks. */
  readonly content: NoteContent;
  /** Plain-text rendering of `content`, kept for search and older builds. */
  readonly body: string;
  readonly dueOn: IsoDate | null;
  /** Whether the due date should interrupt. Meaningless without a due date. */
  readonly notify: boolean;
  readonly done: boolean;
  readonly doneAt: string | null;
  readonly pinned: boolean;
  /** Out of the main grid, but kept and searchable. */
  readonly archived: boolean;
  /** Null is the default, uncoloured card. */
  readonly colour: NoteColour | null;
  /** Null when the note has no checklist items. */
  readonly checklist: ChecklistProgress | null;
  /** The folder it is filed in, or null for none. */
  readonly folderId: string | null;
  /** Where it was dragged to; null if never moved by hand. */
  readonly position: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface NoteFolder {
  readonly id: string;
  readonly name: string;
  readonly colour: string | null;
  readonly sortOrder: number;
}

interface FolderRow {
  id: string;
  name: string | null;
  colour: string | null;
  sort_order: number | null;
}

/** The gap left between neighbours when a note or folder is placed at an end. */
const POSITION_STEP = 1000;

/**
 * A note's place in the arranged order. Never-dragged notes sort by age, newest
 * first — the negated creation time puts newer ones at smaller keys.
 */
function arrangedKey(note: Pick<Note, 'position' | 'createdAt'>): number {
  if (note.position !== null) return note.position;
  const created = note.createdAt ? Date.parse(note.createdAt) : NaN;
  return Number.isNaN(created) ? 0 : -created;
}

function toFolder(row: FolderRow): NoteFolder {
  return {
    id: row.id,
    name: row.name ?? '',
    colour: row.colour,
    sortOrder: row.sort_order ?? 0,
  };
}

/** The result of an edit that may have removed images from the note. */
export interface NoteSave {
  readonly note: Note;
  /**
   * Files no longer referenced by any note, whose records were deleted.
   * The caller removes their ciphertext from this device; sync does the rest.
   */
  readonly released: StoredFile[];
}

export class NoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteValidationError';
  }
}

interface NoteRow {
  id: string;
  title: string | null;
  content: string | null;
  body: string | null;
  due_on: string | null;
  notify: number | null;
  done: number | null;
  done_at: string | null;
  pinned: number | null;
  archived: number | null;
  colour: string | null;
  folder_id: string | null;
  position: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface FileRow {
  id: string;
  filename: string | null;
  mime: string | null;
  size_bytes: number | null;
  sha256: string | null;
  encrypted_path: string | null;
  width: number | null;
  height: number | null;
}

/** The words and blocks of a note, as a caller supplies them. */
interface NoteText {
  title?: string;
  /** The note as blocks. Takes precedence over `body`. */
  content?: NoteContent;
  /** Plain text, for quick capture and older callers; turned into blocks. */
  body?: string;
}

/** Title, content and body fields ready to commit, or an error if empty. */
function textFields(input: NoteText, existing?: Note): Record<string, Json> {
  const title = (input.title ?? existing?.title ?? '').trim();
  const content =
    input.content ??
    (input.body !== undefined ? fromPlainText(input.body.trim()) : existing?.content) ??
    fromPlainText('');

  if (title === '' && isContentEmpty(content)) {
    throw new NoteValidationError('A note needs something written in it.');
  }

  return {
    title,
    content: serializeContent(content),
    body: toPlainText(content),
  };
}

function assertColour(colour: NoteColour | null | undefined): void {
  if (colour === undefined || colour === null) return;
  if (!isNoteColour(colour)) {
    throw new NoteValidationError(`Not a note colour: "${String(colour)}".`);
  }
}

export class NoteRepository {
  constructor(private readonly store: VaultStore) {}

  addNote(
    input: NoteText & {
      dueOn?: IsoDate;
      notify?: boolean;
      pinned?: boolean;
      colour?: NoteColour | null;
      folderId?: string | null;
      id?: string;
    },
  ): Note {
    if (input.dueOn) parseDate(input.dueOn);
    assertColour(input.colour);

    const id = input.id ?? uuidv7();
    this.store.commit('note', id, {
      ...textFields(input),
      due_on: input.dueOn ?? null,
      notify: input.notify ?? false,
      done: false,
      done_at: null,
      pinned: input.pinned ?? false,
      archived: false,
      colour: input.colour ?? null,
      folder_id: input.folderId ?? null,
    });
    return this.getNote(id)!;
  }

  updateNote(id: string, patch: NotePatch): Note {
    return this.saveNote(id, patch).note;
  }

  /**
   * Edit a note, and let go of any images the edit removed.
   *
   * An image deleted from a note is deleted for real, as a document's scan is:
   * the file row goes, so sync removes the bytes from the folder and the other
   * device. Unless another note still shows the same file.
   */
  saveNote(id: string, patch: NotePatch): NoteSave {
    const existing = this.getNote(id);
    if (!existing) throw new NoteValidationError('That note no longer exists.');

    const fields: Record<string, Json> = {};

    if (patch.title !== undefined || patch.content !== undefined || patch.body !== undefined) {
      Object.assign(fields, textFields(patch, existing));
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
    if (patch.archived !== undefined) {
      fields.archived = patch.archived;
      // Keep does the same: an archived note is out of sight, and a pin would
      // be a promise to keep it in sight.
      if (patch.archived) fields.pinned = false;
    }
    if (patch.colour !== undefined) {
      assertColour(patch.colour);
      fields.colour = patch.colour;
    }

    if (Object.keys(fields).length > 0) this.store.commit('note', id, fields);

    const note = this.getNote(id)!;
    const kept = new Set(imageFileIds(note.content));
    const dropped = imageFileIds(existing.content).filter((fileId) => !kept.has(fileId));
    return { note, released: this.releaseUnused(dropped) };
  }

  /** Make a copy of a note, sharing its images rather than duplicating their bytes. */
  duplicateNote(id: string): Note {
    const original = this.getNote(id);
    if (!original) throw new NoteValidationError('That note no longer exists.');
    const copy = this.addNote({
      title: original.title,
      content: {
        ...original.content,
        // Fresh block ids, so editing the copy never looks like editing the original.
        blocks: original.content.blocks.map((block) => ({ ...block, id: uuidv7() })),
      },
      colour: original.colour,
      folderId: original.folderId,
    });
    for (const label of this.labelsFor(id)) this.addLabel(copy.id, label.id);
    return this.getNote(copy.id)!;
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

  /** Delete a note and the images only it was showing. */
  deleteNote(id: string): StoredFile[] {
    const existing = this.getNote(id);
    this.store.remove('note', id);
    for (const label of this.labelsFor(id)) this.removeLabel(id, label.id);
    return existing ? this.releaseUnused(imageFileIds(existing.content)) : [];
  }

  /** Any file the vault holds, for showing a note's images. */
  getFile(fileId: string): StoredFile | undefined {
    const row = this.store.database.get<FileRow>(
      'SELECT * FROM file WHERE id = ? AND deleted_at IS NULL',
      [fileId],
    );
    return row ? toFile(row) : undefined;
  }

  /**
   * Record an encrypted image just written to disk, ready to go into a note.
   *
   * The same file row a document scan uses, so sync carries note images between
   * devices with no extra machinery.
   */
  addImageFile(input: {
    id: string;
    encryptedPath: string;
    sha256?: string;
    sizeBytes?: number;
    mime?: string;
    width?: number;
    height?: number;
    filename?: string;
  }): StoredFile {
    this.store.commit('file', input.id, {
      filename: input.filename ?? null,
      mime: input.mime ?? null,
      size_bytes: input.sizeBytes ?? null,
      sha256: input.sha256 ?? null,
      encrypted_path: input.encryptedPath,
      width: input.width ?? null,
      height: input.height ?? null,
    });
    return this.getFile(input.id)!;
  }

  /**
   * Delete file rows nothing refers to any more.
   *
   * Also how an editor cleans up after itself: an image added to a note that was
   * then discarded unsaved is passed here, and goes, since nothing shows it.
   *
   * "Nothing" means no live note and no live document. The content column is
   * JSON, so a LIKE on the id is a cheap, conservative test: it may keep a file
   * whose id appears in some other text, but it will never delete one in use.
   */
  releaseUnused(fileIds: readonly string[]): StoredFile[] {
    const released: StoredFile[] = [];
    for (const fileId of new Set(fileIds)) {
      const file = this.getFile(fileId);
      if (!file) continue;

      const inNotes = this.store.database.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM note WHERE deleted_at IS NULL AND content LIKE ?`,
        [`%${fileId}%`],
      );
      const inDocuments = this.store.database.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM document WHERE deleted_at IS NULL AND file_id = ?`,
        [fileId],
      );
      if ((inNotes?.n ?? 0) > 0 || (inDocuments?.n ?? 0) > 0) continue;

      this.store.remove('file', fileId);
      released.push(file);
    }
    return released;
  }

  // ----------------------------------------------------------------- labels
  //
  // Labels are the vault's tags, applied to notes. One set of names across
  // documents and notes, so "Travel" finds the passport scan and the packing list.

  addLabel(noteId: string, tagId: string): void {
    this.store.commit('tagging', taggingId('note', noteId, tagId), {
      tag_id: tagId,
      owner_type: 'note',
      owner_id: noteId,
      deleted_at: null,
    });
  }

  removeLabel(noteId: string, tagId: string): void {
    this.store.remove('tagging', taggingId('note', noteId, tagId));
  }

  /** Create a label by name, or return the existing one with that name. */
  ensureLabel(name: string): Tag {
    const trimmed = name.trim();
    if (trimmed === '') throw new NoteValidationError('A label needs a name.');
    const existing = this.store.database.get<{ id: string; name: string; colour: string | null }>(
      `SELECT id, name, colour FROM tag WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE`,
      [trimmed],
    );
    if (existing) return existing;
    const id = uuidv7();
    this.store.commit('tag', id, { name: trimmed, colour: null });
    return { id, name: trimmed, colour: null };
  }

  labelsFor(noteId: string): Tag[] {
    return this.store.database.all<Tag>(
      `SELECT tag.id, tag.name, tag.colour FROM tag
         JOIN tagging ON tagging.tag_id = tag.id
        WHERE tagging.owner_type = 'note' AND tagging.owner_id = ?
          AND tagging.deleted_at IS NULL AND tag.deleted_at IS NULL
        ORDER BY tag.name COLLATE NOCASE`,
      [noteId],
    );
  }

  /** Every label, for the filter row and the label picker. */
  listLabels(): Tag[] {
    return this.store.database.all<Tag>(
      `SELECT id, name, colour FROM tag WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
  }

  /** Ids of the notes carrying a label. */
  notesLabelled(tagId: string): Set<string> {
    return new Set(
      this.store.database
        .all<{ owner_id: string }>(
          `SELECT owner_id FROM tagging
            WHERE owner_type = 'note' AND tag_id = ? AND deleted_at IS NULL`,
          [tagId],
        )
        .map((row) => row.owner_id),
    );
  }

  /**
   * Open notes in the order you arranged them: pinned first, then by where you
   * dragged each one.
   *
   * Separate from `listOpen`, which stays urgency-ordered for the places that
   * ask "what needs me" — a list you arranged by hand is a different question.
   * A note never dragged sits by age, newest on top, as it always has.
   */
  listArranged(folderId?: string | null): Note[] {
    const open = this.listOpen().filter(
      (note) => folderId === undefined || note.folderId === folderId,
    );
    return open.sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || arrangedKey(a) - arrangedKey(b),
    );
  }

  /**
   * Put a note between two others, as a drag and drop leaves it.
   *
   * Only the moved note is written: its position becomes the midpoint of its new
   * neighbours'. Pass null for "at the top" or "at the bottom".
   */
  placeNote(id: string, after: string | null, before: string | null, pinned?: boolean): Note {
    const keyOf = (otherId: string | null) => {
      const other = otherId ? this.getNote(otherId) : undefined;
      return other ? arrangedKey(other) : null;
    };
    const low = keyOf(after);
    const high = keyOf(before);

    const position =
      low !== null && high !== null
        ? (low + high) / 2
        : low !== null
          ? low + POSITION_STEP
          : high !== null
            ? high - POSITION_STEP
            : 0;

    const fields: Record<string, Json> = { position };
    if (pinned !== undefined) fields.pinned = pinned;
    this.store.commit('note', id, fields);
    return this.getNote(id)!;
  }

  // ---------------------------------------------------------------- folders

  addFolder(name: string, id: string = uuidv7()): NoteFolder {
    const trimmed = name.trim();
    if (trimmed === '') throw new NoteValidationError('A folder needs a name.');
    const last = this.listFolders().at(-1);
    this.store.commit('folder', id, {
      name: trimmed,
      colour: null,
      sort_order: (last?.sortOrder ?? 0) + POSITION_STEP,
    });
    return this.getFolder(id)!;
  }

  renameFolder(id: string, name: string): NoteFolder {
    const trimmed = name.trim();
    if (trimmed === '') throw new NoteValidationError('A folder needs a name.');
    this.store.commit('folder', id, { name: trimmed });
    return this.getFolder(id)!;
  }

  /**
   * Delete a folder. Its notes are kept and simply become unfiled: deleting a
   * container is not a request to delete what was in it.
   */
  deleteFolder(id: string): void {
    for (const note of this.notesInFolder(id)) this.store.commit('note', note, { folder_id: null });
    this.store.remove('folder', id);
  }

  getFolder(id: string): NoteFolder | undefined {
    const row = this.store.database.get<FolderRow>(
      'SELECT * FROM folder WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toFolder(row) : undefined;
  }

  listFolders(): NoteFolder[] {
    return this.store.database
      .all<FolderRow>(
        `SELECT * FROM folder WHERE deleted_at IS NULL ORDER BY sort_order ASC, name COLLATE NOCASE`,
      )
      .map(toFolder);
  }

  /** File a note, or unfile it with null. */
  moveToFolder(noteId: string, folderId: string | null): Note {
    if (folderId !== null && !this.getFolder(folderId)) {
      throw new NoteValidationError('That folder no longer exists.');
    }
    this.store.commit('note', noteId, { folder_id: folderId });
    return this.getNote(noteId)!;
  }

  private notesInFolder(folderId: string): string[] {
    return this.store.database
      .all<{ id: string }>(`SELECT id FROM note WHERE folder_id = ? AND deleted_at IS NULL`, [folderId])
      .map((row) => row.id);
  }

  /** Notes put away with archive, newest first. */
  listArchived(): Note[] {
    return this.store.database
      .all<NoteRow>(
        `SELECT * FROM note
          WHERE deleted_at IS NULL AND archived = 1
          ORDER BY updated_at DESC, id DESC`,
      )
      .map(toNote);
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
            AND (archived IS NULL OR archived = 0)
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
            AND (archived IS NULL OR archived = 0)
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

export type NotePatch = NoteText & {
  dueOn?: IsoDate | null;
  notify?: boolean;
  pinned?: boolean;
  archived?: boolean;
  /** Null clears it back to the default card. */
  colour?: NoteColour | null;
};

function toNote(row: NoteRow): Note {
  const body = row.body ?? '';
  const content = parseContent(row.content, body);
  return {
    id: row.id,
    title: row.title ?? '',
    content,
    body,
    dueOn: row.due_on,
    notify: row.notify === 1,
    done: row.done === 1,
    doneAt: row.done_at,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    colour: isNoteColour(row.colour) ? row.colour : null,
    checklist: checklistProgress(content),
    folderId: row.folder_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    encryptedPath: row.encrypted_path,
    width: row.width,
    height: row.height,
  };
}

/** What a card or a notification calls a note: its title, else its first words. */
export function noteHeadline(note: Pick<Note, 'title' | 'body'>, max = 60): string {
  const source = note.title.trim() !== '' ? note.title.trim() : note.body.split('\n').find((line) => line.trim() !== '') ?? '';
  const line = source.trim();
  // Cut a little short of the limit, so the ellipsis never lands mid-glyph on a
  // notification shade that truncates at the limit itself.
  return line.length > max ? `${line.slice(0, max - 3)}…` : line;
}
