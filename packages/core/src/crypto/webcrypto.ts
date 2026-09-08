/**
 * A CryptoProvider on WebCrypto.
 *
 * Uses only primitives available in Node 20+, Electron, and React Native once a
 * WebCrypto shim is installed — no native module, so it works everywhere from day
 * one. The deliberate gap is Argon2id: WebCrypto has no password-hashing KDF, so
 * this provider stretches passphrases with PBKDF2.
 *
 * PBKDF2 is meaningfully weaker than Argon2id against GPU attack. Because the KDF
 * parameters are recorded in the keyfile, a platform can supply an Argon2id
 * provider later and existing vaults keep opening.
 */

import {
  type CryptoProvider,
  DecryptionError,
  type KdfParams,
  NONCE_LENGTH,
} from './types.js';
import { utf8ToBytes } from './base64.js';

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export class UnsupportedKdfError extends Error {
  constructor(algorithm: string) {
    super(
      `This provider cannot compute ${algorithm}. WebCrypto offers no Argon2id; ` +
        `supply a platform CryptoProvider that implements it.`,
    );
    this.name = 'UnsupportedKdfError';
  }
}

export const webCryptoProvider: CryptoProvider = {
  randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  },

  async deriveFromPassphrase(passphrase, salt, params: KdfParams, lengthBytes) {
    // Both PBKDF2 variants are supported so a vault created on either platform
    // opens on the other; only Argon2id needs a native module.
    const hash =
      params.algorithm === 'PBKDF2-SHA512'
        ? 'SHA-512'
        : params.algorithm === 'PBKDF2-SHA256'
          ? 'SHA-256'
          : null;
    if (hash === null) throw new UnsupportedKdfError(params.algorithm);
    const key = await crypto.subtle.importKey(
      'raw',
      bufferOf(utf8ToBytes(passphrase)),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: bufferOf(salt),
        iterations: params.iterations ?? 210_000,
        hash,
      },
      key,
      lengthBytes * 8,
    );
    return new Uint8Array(bits);
  },

  async hkdf(key, info, lengthBytes) {
    const baseKey = await crypto.subtle.importKey('raw', bufferOf(key), 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        // The data key is already uniformly random, so an empty salt is correct:
        // HKDF-Extract exists to condition weak input, which this is not.
        salt: new Uint8Array(0),
        info: bufferOf(utf8ToBytes(info)),
      },
      baseKey,
      lengthBytes * 8,
    );
    return new Uint8Array(bits);
  },

  async encrypt(key, plaintext, aad) {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const aesKey = await crypto.subtle.importKey('raw', bufferOf(key), 'AES-GCM', false, [
      'encrypt',
    ]);
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bufferOf(nonce), additionalData: bufferOf(utf8ToBytes(aad)) },
      aesKey,
      bufferOf(plaintext),
    );
    const out = new Uint8Array(NONCE_LENGTH + sealed.byteLength);
    out.set(nonce, 0);
    out.set(new Uint8Array(sealed), NONCE_LENGTH);
    return out;
  },

  async decrypt(key, sealed, aad) {
    if (sealed.length <= NONCE_LENGTH) {
      throw new DecryptionError('Ciphertext is too short to contain a nonce.');
    }
    const nonce = sealed.subarray(0, NONCE_LENGTH);
    const body = sealed.subarray(NONCE_LENGTH);
    const aesKey = await crypto.subtle.importKey('raw', bufferOf(key), 'AES-GCM', false, [
      'decrypt',
    ]);
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bufferOf(nonce),
          additionalData: bufferOf(utf8ToBytes(aad)),
        },
        aesKey,
        bufferOf(body),
      );
      return new Uint8Array(plaintext);
    } catch {
      // WebCrypto reports every failure identically on purpose: distinguishing a
      // wrong key from a tampered tag would leak information to an attacker.
      throw new DecryptionError();
    }
  },
};
