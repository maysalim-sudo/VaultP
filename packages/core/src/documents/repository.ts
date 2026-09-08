/**
 * Documents: the papers you need and cannot find.
 *
 * Three things make this more than a folder of photos:
 *
 *   expiry     a passport that expires is worth knowing about in advance, not on
 *              the day you reach the airport
 *   tags       many-to-many, never folders — a passport is 'identity' and 'travel'
 *              and '2026' at once, and a folder forces a choice that is wrong
 *   text       OCR output stored beside the file, so search finds a document by
 *              what is written inside it rather than by what you named it
 *
 * The bytes are not here. A scan is megabytes; the database holds metadata and a
 * reference, and the file sits encrypted on disk.
 */

import { uuidv7 } from '../id.js';
import type { SqlValue } from '../db/adapter.js';
import type { VaultStore } from '../db/store.js';
import type { Json } from '../oplog/event.js';
import { type IsoDate, addDays, compareDates, parseDate } from '../time/date.js';

export interface StoredFile {
  readonly id: string;
  readonly filename: string | null;
  readonly mime: string | null;
  readonly sizeBytes: number | null;
  /** Of the plaintext, so duplicates are detectable despite differing ciphertext. */
  readonly sha256: string | null;
  readonly encryptedPath: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface VaultDocument {
  readonly id: string;
  readonly title: string;
  readonly fileId: string | null;
  readonly extractedText: string | null;
  readonly expiryDate: IsoDate | null;
  readonly reminderLeadDays: number;
  readonly note: string | null;
  readonly kind: string | null;
}

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly colour: string | null;
}

export const DEFAULT_REMINDER_LEAD_DAYS = 60;

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentValidationError';
  }
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

interface DocumentRow {
  id: string;
  title: string | null;
  file_id: string | null;
  extracted_text: string | null;
  expiry_date: string | null;
  reminder_lead_days: number | null;
  note: string | null;
  kind: string | null;
}

interface TagRow {
  id: string;
  name: string | null;
  colour: string | null;
}

export class DocumentRepository {
  constructor(private readonly store: VaultStore) {}

  // ------------------------------------------------------------------ files

  addFile(input: {
    id?: string;
    filename?: string;
    mime?: string;
    sizeBytes?: number;
    sha256?: string;
    encryptedPath: string;
    width?: number;
    height?: number;
  }): StoredFile {
    const id = input.id ?? uuidv7();
    this.store.commit('file', id, {
      filename: input.filename ?? null,
      mime: input.mime ?? null,
      size_bytes: input.sizeBytes ?? null,
      sha256: input.sha256 ?? null,
      encrypted_path: input.encryptedPath,
      width: input.width ?? null,
      height: input.height ?? null,
    });
    return this.getFile(id)!;
  }

  getFile(id: string): StoredFile | undefined {
    const row = this.store.database.get<FileRow>(
      'SELECT * FROM file WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toFile(row) : undefined;
  }

  /**
   * Find a file already holding these exact bytes.
   *
   * The hash is of the plaintext, so two encryptions of the same scan — which
   * produce completely different ciphertext — are still recognised as the same
   * document. Without this you end up with four copies of one passport.
   */
  findByHash(sha256: string): StoredFile | undefined {
    const row = this.store.database.get<FileRow>(
      'SELECT * FROM file WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1',
      [sha256],
    );
    return row ? toFile(row) : undefined;
  }

  // -------------------------------------------------------------- documents

  addDocument(input: {
    title: string;
    fileId?: string;
    extractedText?: string;
    expiryDate?: IsoDate;
    reminderLeadDays?: number;
    note?: string;
    kind?: string;
    id?: string;
  }): VaultDocument {
    if (input.title.trim() === '') {
      throw new DocumentValidationError('A document needs a title.');
    }
    if (input.expiryDate) parseDate(input.expiryDate);

    const id = input.id ?? uuidv7();
    this.store.commit('document', id, {
      title: input.title.trim(),
      file_id: input.fileId ?? null,
      extracted_text: input.extractedText ?? null,
      expiry_date: input.expiryDate ?? null,
      reminder_lead_days: input.reminderLeadDays ?? DEFAULT_REMINDER_LEAD_DAYS,
      note: input.note ?? null,
      kind: input.kind ?? null,
    });
    return this.getDocument(id)!;
  }

  updateDocument(
    id: string,
    patch: {
      title?: string;
      expiryDate?: IsoDate | null;
      reminderLeadDays?: number;
      note?: string;
      kind?: string;
      extractedText?: string;
    },
  ): VaultDocument {
    const fields: Record<string, Json> = {};

    if (patch.title !== undefined) {
      if (patch.title.trim() === '') {
        throw new DocumentValidationError('A document needs a title.');
      }
      fields.title = patch.title.trim();
    }
    if (patch.expiryDate !== undefined) {
      if (patch.expiryDate !== null) parseDate(patch.expiryDate);
      fields.expiry_date = patch.expiryDate;
    }
    if (patch.reminderLeadDays !== undefined) {
      fields.reminder_lead_days = patch.reminderLeadDays;
    }
    if (patch.note !== undefined) fields.note = patch.note;
    if (patch.kind !== undefined) fields.kind = patch.kind;
    if (patch.extractedText !== undefined) fields.extracted_text = patch.extractedText;

    if (Object.keys(fields).length > 0) this.store.commit('document', id, fields);
    return this.getDocument(id)!;
  }

  /**
   * Delete a document, and the file behind it.
   *
   * The file row goes too, because it is the deletion every other device sees:
   * sync moves records, so a blob is only removed elsewhere when the row saying
   * it exists is gone. Leaving the row would leave the scan of a deleted
   * document sitting in the sync folder and on the other device.
   *
   * Unless something else still points at it. Two documents can share one file —
   * the same scan filed twice deliberately — and deleting one of them must not
   * take the other's image away.
   */
  deleteDocument(id: string): void {
    const document = this.getDocument(id);
    this.store.remove('document', id);

    if (!document?.fileId) return;

    const others = this.store.database.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM document WHERE file_id = ? AND deleted_at IS NULL',
      [document.fileId],
    );
    if ((others?.n ?? 0) === 0) this.store.remove('file', document.fileId);
  }

  getDocument(id: string): VaultDocument | undefined {
    const row = this.store.database.get<DocumentRow>(
      'SELECT * FROM document WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toDocument(row) : undefined;
  }

  listDocuments(query: { tagId?: string; limit?: number } = {}): VaultDocument[] {
    const params: SqlValue[] = [];
    let sql = `SELECT d.* FROM document d`;

    if (query.tagId) {
      sql += ` JOIN tagging t ON t.owner_id = d.id AND t.owner_type = 'document'
                 AND t.deleted_at IS NULL AND t.tag_id = ?`;
      params.push(query.tagId);
    }

    sql += ` WHERE d.deleted_at IS NULL ORDER BY d.title COLLATE NOCASE ASC`;

    if (query.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    return this.store.database.all<DocumentRow>(sql, params).map(toDocument);
  }

  /**
   * Search by what is written in the document, not just its title.
   *
   * A plain LIKE over the OCR text. Slower than an FTS index, but the corpus here
   * is a few hundred documents on a phone, and it avoids keeping a second index in
   * step with the event log for no measurable gain.
   */
  searchDocuments(term: string): VaultDocument[] {
    const trimmed = term.trim();
    if (trimmed === '') return [];

    const pattern = `%${trimmed.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    return this.store.database
      .all<DocumentRow>(
        `SELECT * FROM document
          WHERE deleted_at IS NULL
            AND (title LIKE ? ESCAPE '\\' OR extracted_text LIKE ? ESCAPE '\\'
                 OR note LIKE ? ESCAPE '\\')
          ORDER BY title COLLATE NOCASE ASC`,
        [pattern, pattern, pattern],
      )
      .map(toDocument);
  }

  // ------------------------------------------------------------------- tags

  addTag(input: { name: string; colour?: string; id?: string }): Tag {
    if (input.name.trim() === '') {
      throw new DocumentValidationError('A tag needs a name.');
    }
    const id = input.id ?? uuidv7();
    this.store.commit('tag', id, {
      name: input.name.trim(),
      colour: input.colour ?? null,
    });
    return this.getTag(id)!;
  }

  getTag(id: string): Tag | undefined {
    const row = this.store.database.get<TagRow>(
      'SELECT * FROM tag WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toTag(row) : undefined;
  }

  listTags(): Tag[] {
    return this.store.database
      .all<TagRow>(
        'SELECT * FROM tag WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE',
      )
      .map(toTag);
  }

  /**
   * Tagging is idempotent: applying a tag twice leaves one row.
   *
   * The id is derived from the pair, so two devices tagging the same document
   * offline converge on a single tagging rather than a duplicate.
   */
  tagDocument(documentId: string, tagId: string): void {
    this.store.commit('tagging', taggingId('document', documentId, tagId), {
      tag_id: tagId,
      owner_type: 'document',
      owner_id: documentId,
      deleted_at: null,
    });
  }

  untagDocument(documentId: string, tagId: string): void {
    this.store.remove('tagging', taggingId('document', documentId, tagId));
  }

  tagsFor(documentId: string): Tag[] {
    return this.store.database
      .all<TagRow>(
        `SELECT tag.* FROM tag
           JOIN tagging ON tagging.tag_id = tag.id
          WHERE tagging.owner_type = 'document'
            AND tagging.owner_id = ?
            AND tagging.deleted_at IS NULL
            AND tag.deleted_at IS NULL
          ORDER BY tag.name COLLATE NOCASE`,
        [documentId],
      )
      .map(toTag);
  }

  // ----------------------------------------------------------------- expiry

  /**
   * Documents expiring soon, or already expired.
   *
   * Each document carries its own lead time: a passport is worth six months of
   * warning because renewing one takes months, while a gym membership needs a
   * week. One global setting would be wrong for both.
   */
  expiringSoon(asOf: IsoDate, horizonDays?: number): VaultDocument[] {
    return this.store.database
      .all<DocumentRow>(
        `SELECT * FROM document
          WHERE deleted_at IS NULL AND expiry_date IS NOT NULL
          ORDER BY expiry_date ASC`,
      )
      .map(toDocument)
      .filter((document) => {
        if (!document.expiryDate) return false;
        const lead = horizonDays ?? document.reminderLeadDays;
        const warnFrom = addDays(document.expiryDate, -lead);
        return compareDates(warnFrom, asOf) <= 0;
      });
  }

  expired(asOf: IsoDate): VaultDocument[] {
    return this.expiringSoon(asOf, 100_000).filter(
      (document) => document.expiryDate !== null && compareDates(document.expiryDate, asOf) < 0,
    );
  }
}

/** Deterministic, so the same pair is one row on every device. */
export function taggingId(ownerType: string, ownerId: string, tagId: string): string {
  return `tagging:${ownerType}:${ownerId}:${tagId}`;
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

function toDocument(row: DocumentRow): VaultDocument {
  return {
    id: row.id,
    title: row.title ?? '',
    fileId: row.file_id,
    extractedText: row.extracted_text,
    expiryDate: row.expiry_date,
    reminderLeadDays: row.reminder_lead_days ?? DEFAULT_REMINDER_LEAD_DAYS,
    note: row.note,
    kind: row.kind,
  };
}

function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name ?? '', colour: row.colour };
}
