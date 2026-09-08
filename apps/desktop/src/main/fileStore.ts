/**
 * Encrypted files on disk, in the format the phone writes.
 *
 * SQLCipher protects the database, but a scan of a passport is not in the
 * database — it is a file, and a file written plainly would sit in app storage
 * readable by anything that gets at the machine. So each one is encrypted before
 * it is written, with a key of its own.
 *
 * The layout deliberately matches `apps/mobile/src/documents/fileStore.ts`: the
 * same relative path shape, the same per-file key derivation, the same
 * additional data. Sync moves records rather than bytes today, so a scan taken
 * on one device cannot be opened on the other — but the ciphertext the two
 * produce is interchangeable, so carrying the bytes across is a matter of
 * moving them, not of a second format.
 *
 * PER-FILE KEYS: AES-GCM must never reuse a nonce under one key. Deriving a key
 * per file removes the question entirely, rather than relying on a global
 * counter staying correct across two devices, app restarts and a restore.
 *
 * The plaintext is hashed before encryption. Two encryptions of one scan produce
 * completely different ciphertext, so hashing the ciphertext would never spot a
 * duplicate — which is the whole point of hashing it.
 *
 * The vault root is passed in rather than read from Electron here, so this file
 * loads under plain Node. That is what makes the format testable at all: the
 * tests cannot import `electron`.
 */

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  deriveFileKey,
  sha256,
  toHex,
  uuidv7,
  webCryptoProvider,
  type LocalFileStore,
  type StoredFile,
  type VaultKeys,
} from '@vaultp/core';

/** Encrypted originals. Never cleared automatically — this is the vault. */
const VAULT_FILES = 'vault-files';

/** Binds the ciphertext to the file it belongs to. */
function aadFor(fileId: string): string {
  return `vaultp/file/v1/${fileId}`;
}

export interface ImportedFile {
  readonly id: string;
  readonly encryptedPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/**
 * Encrypt a chosen file into the vault.
 *
 * Returns the hash as well, so the caller can notice it already holds this exact
 * document before creating a second record for it.
 */
export async function importFile(
  root: string,
  keys: VaultKeys,
  sourcePath: string,
): Promise<ImportedFile> {
  const plaintext = new Uint8Array(await readFile(sourcePath));

  const id = uuidv7();
  const fileKey = await deriveFileKey(webCryptoProvider, keys.files, id);
  const sealed = await webCryptoProvider.encrypt(fileKey, plaintext, aadFor(id));

  await mkdir(join(root, VAULT_FILES), { recursive: true });
  await writeFile(join(root, VAULT_FILES, `${id}.enc`), sealed);

  return {
    id,
    encryptedPath: encryptedPathFor(id),
    sha256: toHex(sha256(plaintext)),
    sizeBytes: plaintext.length,
  };
}

export class MissingFileError extends Error {
  constructor() {
    super(
      'The scan is not on this computer yet. Sync fetches it once the device ' +
        'that took it has pushed it.',
    );
    this.name = 'MissingFileError';
  }
}

/** Decrypt into memory. Nothing plaintext is written unless the caller asks. */
export async function decryptFile(
  root: string,
  keys: VaultKeys,
  file: StoredFile,
): Promise<Uint8Array> {
  if (!file.encryptedPath) throw new MissingFileError();

  const path = join(root, file.encryptedPath);
  let sealed: Uint8Array;
  try {
    sealed = new Uint8Array(await readFile(path));
  } catch {
    throw new MissingFileError();
  }

  const fileKey = await deriveFileKey(webCryptoProvider, keys.files, file.id);
  return webCryptoProvider.decrypt(fileKey, sealed, aadFor(file.id));
}

/**
 * Delete the ciphertext.
 *
 * The database row is soft-deleted and stays in the history, but the bytes are
 * removed for real: keeping the scan of a document you deleted would defeat the
 * point of deleting it.
 */
export async function deleteEncrypted(root: string, encryptedPath: string | null): Promise<void> {
  if (!encryptedPath) return;
  await rm(join(root, encryptedPath), { force: true });
}

/**
 * The same directory, as sync needs to see it.
 *
 * Sealed bytes in and out, and no key: what sync copies to the folder is exactly
 * what is on disk here, which is the whole reason the folder never sees anything
 * readable.
 */
export function desktopFileStore(root: string): LocalFileStore {
  const pathFor = (fileId: string) => join(root, VAULT_FILES, `${fileId}.enc`);

  return {
    async has(fileId) {
      try {
        await access(pathFor(fileId));
        return true;
      } catch {
        return false;
      }
    },

    async read(fileId) {
      return new Uint8Array(await readFile(pathFor(fileId)));
    },

    async write(fileId, sealed) {
      await mkdir(join(root, VAULT_FILES), { recursive: true });
      await writeFile(pathFor(fileId), sealed);
    },

    async remove(fileId) {
      await rm(pathFor(fileId), { force: true });
    },
  };
}

/** Where a file id's ciphertext lives, relative to the vault root. */
export function encryptedPathFor(fileId: string): string {
  return `${VAULT_FILES}/${fileId}.enc`;
}
