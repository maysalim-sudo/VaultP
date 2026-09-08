/**
 * Sync over a folder the user picks on the phone.
 *
 * Android hands out a directory through the system picker, and the app can then
 * read and write inside it and nowhere else. Point it at something a sync tool
 * already keeps in step — a Syncthing folder, a shared drive, a stick — and the
 * phone and the desktop meet there.
 *
 * No account, no OAuth, no token. The architecture's fallback plan, and the
 * reason the Drive question was never allowed to block anything: the sync engine
 * only ever needed something that stores bytes.
 *
 * WRITING THROUGH SAF IS NOT WRITING TO A PATH. A granted folder is a
 * `content://` tree, not a filesystem location, and the file-oriented calls that
 * work in the app's own storage are rejected on it: a file must be created *by
 * its parent directory*, which is what hands back a usable handle. Everything
 * below goes through the directory for that reason.
 */

import { Directory, File } from 'expo-file-system';

import { ObjectNotFoundError, type RemoteObject, type StorageBackend } from '@vaultp/core';

const SEGMENT_MIME = 'application/octet-stream';

export class PhoneFolderBackend implements StorageBackend {
  /** @param rootUri a content:// tree the user granted through the picker. */
  constructor(private readonly rootUri: string) {}

  /**
   * Walk to a subdirectory, creating what is missing.
   *
   * `createDirectory` on the parent rather than `create()` on the child: under
   * SAF only the parent can bring a child into existence.
   */
  private directoryFor(segments: readonly string[]): Directory {
    let current = new Directory(this.rootUri);

    for (const segment of segments) {
      const existing = current
        .list()
        .find((entry): entry is Directory => entry instanceof Directory && entry.name === segment);

      current = existing ?? current.createDirectory(segment);
    }

    return current;
  }

  private findFile(directory: Directory, name: string): File | undefined {
    return directory
      .list()
      .find((entry): entry is File => entry instanceof File && entry.name === name);
  }

  list(prefix: string): Promise<RemoteObject[]> {
    const found: RemoteObject[] = [];

    const walk = (directory: Directory, path: string): void => {
      if (!directory.exists) return;

      for (const entry of directory.list()) {
        const name = entry.name;
        const key = path === '' ? name : `${path}/${name}`;

        if (entry instanceof Directory) {
          walk(entry, key);
          continue;
        }
        // Partial copies from whatever keeps this folder in sync. Handing one to
        // the decryptor would look like corruption rather than an unfinished
        // download.
        if (name.endsWith('.tmp') || name.startsWith('.')) continue;
        if (!key.startsWith(prefix)) continue;

        found.push({ key, size: entry.size ?? 0 });
      }
    };

    walk(new Directory(this.rootUri), '');

    return Promise.resolve(
      found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const segments = key.split('/');
    const name = segments.pop()!;

    const file = this.findFile(this.directoryFor(segments), name);
    if (!file?.exists) throw new ObjectNotFoundError(key);

    return file.bytes();
  }

  /**
   * Segments are immutable once written, so an existing one is already what we
   * would write. Replacing it would mean a delete and a create, and a reader
   * arriving between the two would find nothing where a file had been.
   */
  put(key: string, data: Uint8Array): Promise<void> {
    const segments = key.split('/');
    const name = segments.pop()!;
    const directory = this.directoryFor(segments);

    const existing = this.findFile(directory, name);
    if (existing) return Promise.resolve();

    const file = directory.createFile(name, SEGMENT_MIME);
    file.write(data);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    const segments = key.split('/');
    const name = segments.pop()!;

    const file = this.findFile(this.directoryFor(segments), name);
    if (file?.exists) file.delete();

    return Promise.resolve();
  }
}
