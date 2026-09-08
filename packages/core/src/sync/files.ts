/**
 * Carrying the scans themselves between devices.
 *
 * The oplog moves records. A record says a passport exists, what it is called and
 * when it expires — but the image is a file, and a file is not an event. Without
 * this, a document scanned on the phone arrives on the desktop complete except
 * for the one part someone actually wants to look at.
 *
 * NOTHING IS ENCRYPTED HERE, AND NOTHING NEEDS TO BE. A stored file is already
 * sealed with a key derived per file, and its additional data binds it to its own
 * id. So the bytes are copied across verbatim: the folder sees the same
 * ciphertext the device holds, sync never touches the file key, and a blob moved
 * to another id's key stops decrypting — the same protection segments get from
 * being bound to their device and sequence.
 *
 * ONE WRITER PER KEY still holds, which is what keeps the design free of
 * locking. A file id is minted by the device that imported the file, so
 * `files/<id>.enc` has exactly one possible author; every other device only ever
 * reads it.
 */

import type { VaultStore } from '../db/store.js';
import type { StorageBackend } from './backend.js';
import { ObjectNotFoundError } from './backend.js';

export const FILES_PREFIX = 'files/';

export function fileObjectKey(fileId: string): string {
  return `${FILES_PREFIX}${fileId}.enc`;
}

export function parseFileObjectKey(key: string): string | null {
  const match = /^files\/(.+)\.enc$/.exec(key);
  return match ? match[1]! : null;
}

/**
 * This device's encrypted-file storage, as sync needs to see it.
 *
 * Deliberately blunt: sync moves opaque bytes and must not know how either
 * platform stores them. The desktop writes into its own directory, the phone
 * into app storage, and neither detail belongs here.
 */
export interface LocalFileStore {
  /** Whether the ciphertext for this file is on this device. */
  has(fileId: string): Promise<boolean>;
  /** The sealed bytes, exactly as stored. */
  read(fileId: string): Promise<Uint8Array>;
  /** Store sealed bytes that came from another device. */
  write(fileId: string, sealed: Uint8Array): Promise<void>;
  /** Remove the ciphertext. Removing what is not there is not an error. */
  remove(fileId: string): Promise<void>;
}

export interface FileSyncReport {
  readonly uploadedFiles: number;
  readonly downloadedFiles: number;
  /** Blobs removed because the record they belonged to was deleted. */
  readonly removedFiles: number;
  /**
   * Records whose bytes are on neither this device nor the folder yet.
   *
   * Not an error: the device holding them has simply not synced since the file
   * was added. Counted so the app can say that rather than implying loss.
   */
  readonly awaitingFiles: number;
}

export const EMPTY_FILE_REPORT: FileSyncReport = {
  uploadedFiles: 0,
  downloadedFiles: 0,
  removedFiles: 0,
  awaitingFiles: 0,
};

interface FileRow {
  id: string;
  deleted_at: string | null;
}

/**
 * Reconcile this device's files with the folder's.
 *
 * Runs after the oplog has been merged, so the file table already reflects
 * everything both devices know about — including rows deleted elsewhere, whose
 * bytes are then removed rather than left behind.
 */
export async function syncFiles(options: {
  readonly store: VaultStore;
  readonly backend: StorageBackend;
  readonly files: LocalFileStore;
}): Promise<FileSyncReport> {
  const { store, backend, files } = options;

  const rows = store.database.all<FileRow>('SELECT id, deleted_at FROM file');
  if (rows.length === 0) return EMPTY_FILE_REPORT;

  const remote = new Set<string>();
  for (const object of await backend.list(FILES_PREFIX)) {
    const id = parseFileObjectKey(object.key);
    if (id) remote.add(id);
  }

  let uploadedFiles = 0;
  let downloadedFiles = 0;
  let removedFiles = 0;
  let awaitingFiles = 0;

  for (const row of rows) {
    if (row.deleted_at !== null) {
      // The record is gone, so the bytes go too — on this device and in the
      // folder. Keeping the scan of a document someone deleted would defeat the
      // point of deleting it, and the folder is the copy that outlives both
      // devices.
      await files.remove(row.id);
      if (remote.has(row.id)) {
        await backend.delete(fileObjectKey(row.id));
        removedFiles += 1;
      }
      continue;
    }

    const here = await files.has(row.id);

    if (here && !remote.has(row.id)) {
      await backend.put(fileObjectKey(row.id), await files.read(row.id));
      uploadedFiles += 1;
      continue;
    }

    if (!here && remote.has(row.id)) {
      try {
        await files.write(row.id, await backend.get(fileObjectKey(row.id)));
        downloadedFiles += 1;
      } catch (error) {
        // Listed but gone: a concurrent delete, or a folder mid-copy. Left for
        // the next run rather than failing the sync that carried the records.
        if (!(error instanceof ObjectNotFoundError)) throw error;
        awaitingFiles += 1;
      }
      continue;
    }

    if (!here && !remote.has(row.id)) awaitingFiles += 1;
  }

  return { uploadedFiles, downloadedFiles, removedFiles, awaitingFiles };
}
