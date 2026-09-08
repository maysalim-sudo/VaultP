/**
 * Subkeys derived from the root data key.
 *
 * Each purpose gets its own key, so a weakness in one context cannot be carried
 * into another: an exported file's key reveals nothing about the database, and the
 * oplog segments uploaded to Google Drive are encrypted under a key never used for
 * anything stored on the device.
 *
 * Derivation is HKDF with a distinct info string per purpose. It is deterministic,
 * so the same passphrase reproduces every subkey on a new device with nothing but
 * the keyfile.
 */

import type { CryptoProvider } from './types.js';
import { KEY_LENGTH } from './types.js';

export const KEY_INFO = {
  database: 'vaultp/db',
  files: 'vaultp/files',
  oplog: 'vaultp/oplog',
  credentials: 'vaultp/credentials',
} as const;

export interface VaultKeys {
  /** SQLCipher key for the local database. */
  readonly database: Uint8Array;
  /** Parent key for per-file keys; never used to encrypt directly. */
  readonly files: Uint8Array;
  /** Encrypts oplog segments and snapshots before upload. */
  readonly oplog: Uint8Array;
  /**
   * Encrypts credentials for services the user connects, such as a Drive
   * refresh token.
   *
   * A refresh token is a standing grant, so it is protected by the passphrase
   * like everything else rather than left in a file beside the database. The
   * practical consequence is deliberate: a locked vault cannot sync, because
   * nothing can reach the token until someone opens it.
   */
  readonly credentials: Uint8Array;
}

export async function deriveVaultKeys(
  provider: CryptoProvider,
  dataKey: Uint8Array,
): Promise<VaultKeys> {
  const [database, files, oplog, credentials] = await Promise.all([
    provider.hkdf(dataKey, KEY_INFO.database, KEY_LENGTH),
    provider.hkdf(dataKey, KEY_INFO.files, KEY_LENGTH),
    provider.hkdf(dataKey, KEY_INFO.oplog, KEY_LENGTH),
    provider.hkdf(dataKey, KEY_INFO.credentials, KEY_LENGTH),
  ]);
  return { database, files, oplog, credentials };
}

/**
 * A distinct key per file.
 *
 * AES-GCM must never reuse a nonce under the same key. Giving every file its own
 * key removes the risk entirely rather than relying on a global nonce counter
 * staying correct across two devices and app restarts.
 */
export function deriveFileKey(
  provider: CryptoProvider,
  filesKey: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  return provider.hkdf(filesKey, `${KEY_INFO.files}/${fileId}`, KEY_LENGTH);
}

/**
 * SQLCipher raw-key form: `PRAGMA key = "x'<hex>'"`.
 *
 * Passing the key as raw hex skips SQLCipher's own key derivation. That is correct
 * here — the key is already a 256-bit HKDF output, and letting SQLCipher stretch it
 * again would add cost without adding entropy.
 */
export function toSqlCipherKey(databaseKey: Uint8Array): string {
  let hex = '';
  for (const byte of databaseKey) hex += byte.toString(16).padStart(2, '0');
  return `x'${hex}'`;
}

/** Overwrite key material once it is no longer needed. */
export function wipe(...keys: Uint8Array[]): void {
  for (const key of keys) key.fill(0);
}
