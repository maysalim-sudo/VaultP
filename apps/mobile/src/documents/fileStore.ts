/**
 * Encrypted files on disk.
 *
 * SQLCipher protects the database, but a scan of a passport is not in the
 * database — it is a file, and a file written plainly would sit in app storage
 * readable by anything that gets at the device. So each one is encrypted before
 * it is written, with a key of its own.
 *
 * PER-FILE KEYS: AES-GCM must never reuse a nonce under one key. Deriving a key
 * per file removes the question entirely, rather than relying on a global counter
 * staying correct across two devices, app restarts and a restore from backup.
 *
 * The plaintext is hashed before encryption. Two encryptions of one scan produce
 * completely different ciphertext, so hashing the ciphertext would never spot a
 * duplicate — which is the whole point of hashing it.
 */

import { Directory, File, Paths } from 'expo-file-system';

import {
  deriveFileKey,
  sha256,
  toHex,
  uuidv7,
  type LocalFileStore,
  type StoredFile,
  type VaultKeys,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';

/** Encrypted originals. Never cleared automatically — this is the vault. */
const VAULT_FILES = 'vault-files';
/** Decrypted copies for viewing. Disposable, and cleared on unlock. */
const PLAINTEXT_CACHE = 'vault-preview';

function vaultDirectory(): Directory {
  const directory = new Directory(Paths.document, VAULT_FILES);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function cacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, PLAINTEXT_CACHE);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

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
 * Encrypt a picked file into the vault.
 *
 * Returns the hash as well, so the caller can notice it already has this exact
 * document before creating a second record for it.
 */
export async function importFile(
  keys: VaultKeys,
  sourceUri: string,
): Promise<ImportedFile> {
  const source = new File(sourceUri);
  const plaintext = await source.bytes();

  const id = uuidv7();
  const fileKey = await deriveFileKey(androidCryptoProvider, keys.files, id);
  const sealed = await androidCryptoProvider.encrypt(fileKey, plaintext, aadFor(id));

  const target = new File(vaultDirectory(), `${id}.enc`);
  target.create();
  target.write(sealed);

  return {
    id,
    encryptedPath: `${VAULT_FILES}/${id}.enc`,
    sha256: toHex(sha256(plaintext)),
    sizeBytes: plaintext.length,
  };
}

/**
 * Decrypt a file for viewing, returning a URI an <Image> can load.
 *
 * The plaintext copy lands in the cache directory, which Android may clear on its
 * own and which `clearPreviews` empties on every unlock. Decrypting straight into
 * memory as a data URI would be tidier, but a multi-megabyte base64 string on the
 * JavaScript thread stutters visibly on this hardware.
 */
export async function decryptForViewing(
  keys: VaultKeys,
  file: StoredFile,
): Promise<string> {
  if (!file.encryptedPath) throw new Error('This file has no stored path.');

  const encrypted = new File(Paths.document, file.encryptedPath);
  if (!encrypted.exists) {
    throw new Error('The encrypted file is missing from this device.');
  }

  const sealed = await encrypted.bytes();
  const fileKey = await deriveFileKey(androidCryptoProvider, keys.files, file.id);
  const plaintext = await androidCryptoProvider.decrypt(fileKey, sealed, aadFor(file.id));

  const preview = new File(cacheDirectory(), `${file.id}${extensionFor(file.mime)}`);
  if (preview.exists) preview.delete();
  preview.create();
  preview.write(plaintext);

  return preview.uri;
}

/** Remove the decrypted copies. Called on unlock, so a crash cannot leave them. */
export function clearPreviews(): void {
  const directory = cacheDirectory();
  if (directory.exists) directory.delete();
}

/**
 * Delete the ciphertext.
 *
 * The database row is soft-deleted and stays in the history, but the bytes are
 * removed for real: keeping the scan of a document you deleted would defeat the
 * point of deleting it.
 */
export function deleteEncrypted(encryptedPath: string | null): void {
  if (!encryptedPath) return;
  const file = new File(Paths.document, encryptedPath);
  if (file.exists) file.delete();
}

function extensionFor(mime: string | null): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.jpg';
  }
}

/**
 * The vault directory, as sync needs to see it.
 *
 * Sealed bytes in and out, and no key: a scan taken here goes to the folder as
 * the ciphertext already on disk, and one taken on the desktop arrives the same
 * way. Neither device re-wraps anything, so both can open what the other wrote.
 */
export function phoneFileStore(): LocalFileStore {
  const fileFor = (fileId: string) => new File(vaultDirectory(), `${fileId}.enc`);

  return {
    has(fileId) {
      return Promise.resolve(fileFor(fileId).exists);
    },

    read(fileId) {
      return fileFor(fileId).bytes();
    },

    write(fileId, sealed) {
      // Created by the parent directory, as everything under a granted tree
      // must be — see the note at the top of the sync backend.
      const target = vaultDirectory().createFile(`${fileId}.enc`, 'application/octet-stream');
      target.write(sealed);
      return Promise.resolve();
    },

    remove(fileId) {
      const file = fileFor(fileId);
      if (file.exists) file.delete();
      return Promise.resolve();
    },
  };
}
