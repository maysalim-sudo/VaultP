/**
 * Sync over an ordinary folder.
 *
 * This is the escape hatch the architecture called for. Point it at a directory
 * that something else keeps in sync — Google Drive's desktop client, Syncthing, a
 * network share, a USB stick — and two devices converge without this app holding
 * an API key, an OAuth token, or an account with anybody.
 *
 * The contents are already encrypted before they arrive here, so whatever is
 * syncing the folder sees ciphertext and filenames.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';

import { ObjectNotFoundError, type RemoteObject, type StorageBackend } from '@vaultp/core';

export class FolderBackend implements StorageBackend {
  constructor(private readonly root: string) {}

  /** Keys are POSIX-style regardless of platform, so a folder shared between a
   *  phone and Windows resolves to the same names on both. */
  private pathFor(key: string): string {
    return join(this.root, ...key.split('/'));
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const found: RemoteObject[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        // A folder that does not exist yet is an empty folder, not an error: the
        // first sync from a fresh device finds nothing and that is correct.
        return;
      }

      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        // Partial files from a sync client still copying: including one would
        // hand a truncated segment to the decryptor.
        if (entry.name.endsWith('.tmp') || entry.name.startsWith('.')) continue;

        const key = relative(this.root, full).split(sep).join(posix.sep);
        if (!key.startsWith(prefix)) continue;

        const info = await stat(full);
        found.push({ key, size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    };

    await walk(this.root);
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  /**
   * Write to a temporary name, then rename into place.
   *
   * A sync client watching the folder will copy whatever it sees. Writing
   * directly would let it pick up a half-written segment and hand a truncated
   * file to the other device; a rename is atomic, so the file appears complete or
   * not at all.
   */
  async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    const temporary = `${target}.${createHash('sha256')
      .update(key)
      .digest('hex')
      .slice(0, 8)}.tmp`;

    await writeFile(temporary, data);
    const { rename } = await import('node:fs/promises');
    await rename(temporary, target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
