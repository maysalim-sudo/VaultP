/**
 * Cryptographic primitives, injected rather than imported.
 *
 * The key hierarchy and the keyfile format live in core and are tested here. The
 * primitives themselves cannot: Android, Electron and Node offer different
 * implementations, and the best password KDF (Argon2id) needs a native module on
 * every platform. Putting them behind an interface means the security-critical
 * *logic* is written and tested once, while each platform supplies the fastest
 * correct primitive it has.
 */

export type KdfAlgorithm = 'PBKDF2-SHA512' | 'PBKDF2-SHA256' | 'Argon2id';

/**
 * KDF parameters are stored in the keyfile, never assumed.
 *
 * Algorithm agility is the point: a vault created today with PBKDF2 must still
 * open after the app switches to Argon2id, and iteration counts must be able to
 * rise as hardware gets faster without orphaning existing vaults.
 */
export interface KdfParams {
  readonly algorithm: KdfAlgorithm;
  /** PBKDF2 only. */
  readonly iterations?: number;
  /** Argon2id only. */
  readonly memoryKiB?: number;
  readonly parallelism?: number;
}

/**
 * PBKDF2-SHA512 at 210k iterations — the OWASP figure for this construction.
 *
 * Chosen as the default because WebCrypto provides it everywhere with no native
 * dependency. Argon2id resists GPU cracking far better and should replace it once
 * the platform modules are wired up; because the parameters live in the keyfile,
 * that swap will not break existing vaults.
 */
export const DEFAULT_KDF: KdfParams = {
  algorithm: 'PBKDF2-SHA512',
  iterations: 210_000,
};

export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;

  /** Stretch a passphrase into a key-encryption key. Deliberately slow. */
  deriveFromPassphrase(
    passphrase: string,
    salt: Uint8Array,
    params: KdfParams,
    lengthBytes: number,
  ): Promise<Uint8Array>;

  /** Split one high-entropy key into independent subkeys. Fast, not a password KDF. */
  hkdf(key: Uint8Array, info: string, lengthBytes: number): Promise<Uint8Array>;

  /** AES-256-GCM. Returns nonce || ciphertext || tag. */
  encrypt(key: Uint8Array, plaintext: Uint8Array, aad: string): Promise<Uint8Array>;

  /** Throws DecryptionError if the key is wrong or the data was tampered with. */
  decrypt(key: Uint8Array, sealed: Uint8Array, aad: string): Promise<Uint8Array>;
}

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed: wrong key, or the data was altered.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class WeakPassphraseError extends Error {
  constructor(minimum: number) {
    super(
      `Passphrase must be at least ${minimum} characters. It is the only way back ` +
        `into this vault, and the only thing standing between a stolen backup and ` +
        `its contents.`,
    );
    this.name = 'WeakPassphraseError';
  }
}

/** Deliberately low: length is enforced, strength is the user's judgement. */
export const MIN_PASSPHRASE_LENGTH = 12;

export const KEY_LENGTH = 32; // AES-256
export const SALT_LENGTH = 16;
export const NONCE_LENGTH = 12; // AES-GCM standard
