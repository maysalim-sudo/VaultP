/**
 * The Android CryptoProvider.
 *
 * Hermes has no `crypto.subtle`, so the WebCrypto provider cannot run here.
 * Randomness and HKDF are portable JavaScript — HKDF is a handful of HMACs and
 * costs nothing. Passphrase derivation and AES-GCM come from a native module.
 *
 * WHY NATIVE, MEASURED RATHER THAN ASSUMED: PBKDF2 in JavaScript on this phone
 * ran 10,000 iterations in 3.8 seconds — roughly 40x slower than Node. At the
 * 210,000 iterations this vault uses that is 80 seconds, and at the 600,000
 * OWASP recommends for SHA-256 it is nearly four minutes. Tuning the count down
 * until JavaScript felt fast would have meant choosing a weak KDF to hide a slow
 * implementation, which is the wrong trade for something guarding ID documents.
 */

import { Buffer } from '@craftzdog/react-native-buffer';
import { pbkdf2, createCipheriv, createDecipheriv } from 'react-native-quick-crypto';

import {
  type CryptoProvider,
  DecryptionError,
  type KdfParams,
  NONCE_LENGTH,
  hkdf as portableHkdf,
  utf8ToBytes,
} from '@vaultp/core';

export class UnsupportedAlgorithmError extends Error {
  constructor(algorithm: string) {
    super(
      `This device cannot compute ${algorithm}. The vault records which algorithm ` +
        `it was created with, so a vault made by a newer build may need an app update.`,
    );
    this.name = 'UnsupportedAlgorithmError';
  }
}

function digestFor(params: KdfParams): 'sha256' | 'sha512' {
  switch (params.algorithm) {
    case 'PBKDF2-SHA256':
      return 'sha256';
    case 'PBKDF2-SHA512':
      return 'sha512';
    default:
      throw new UnsupportedAlgorithmError(params.algorithm);
  }
}

export const androidCryptoProvider: CryptoProvider = {
  randomBytes(length) {
    // Backed by react-native-get-random-values, imported at app entry. Without
    // that polyfill this throws rather than returning predictable bytes.
    return crypto.getRandomValues(new Uint8Array(length));
  },

  hkdf(key, info, lengthBytes) {
    // Byte-for-byte identical to WebCrypto's HKDF; the core test suite asserts it
    // on every run, so the phone and the desktop derive the same keys.
    return Promise.resolve(portableHkdf(key, utf8ToBytes(info), lengthBytes));
  },

  deriveFromPassphrase(passphrase, salt, params, lengthBytes) {
    const digest = digestFor(params);
    const iterations = params.iterations ?? 210_000;

    return new Promise((resolve, reject) => {
      pbkdf2(
        utf8ToBytes(passphrase),
        salt,
        iterations,
        lengthBytes,
        digest,
        (error: Error | null, derived?: Uint8Array) => {
          if (error || !derived) {
            reject(error ?? new Error('Key derivation failed.'));
            return;
          }
          resolve(new Uint8Array(derived));
        },
      );
    });
  },

  encrypt(key, plaintext, aad) {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(utf8ToBytes(aad)));

    const head = cipher.update(Buffer.from(plaintext));
    const rest = cipher.final();
    const tag = cipher.getAuthTag();

    // nonce || ciphertext || tag, matching the WebCrypto provider's layout so a
    // segment written on the phone opens on the desktop and the other way round.
    const sealed = new Uint8Array(nonce.length + head.length + rest.length + tag.length);
    sealed.set(nonce, 0);
    sealed.set(new Uint8Array(head), nonce.length);
    sealed.set(new Uint8Array(rest), nonce.length + head.length);
    sealed.set(new Uint8Array(tag), nonce.length + head.length + rest.length);
    return Promise.resolve(sealed);
  },

  decrypt(key, sealed, aad) {
    const TAG_LENGTH = 16;
    if (sealed.length <= NONCE_LENGTH + TAG_LENGTH) {
      return Promise.reject(new DecryptionError('Ciphertext is too short.'));
    }

    const nonce = sealed.subarray(0, NONCE_LENGTH);
    const body = sealed.subarray(NONCE_LENGTH, sealed.length - TAG_LENGTH);
    const tag = sealed.subarray(sealed.length - TAG_LENGTH);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(utf8ToBytes(aad)));
      decipher.setAuthTag(Buffer.from(tag));

      const head = decipher.update(Buffer.from(body));
      const rest = decipher.final();

      const plaintext = new Uint8Array(head.length + rest.length);
      plaintext.set(new Uint8Array(head), 0);
      plaintext.set(new Uint8Array(rest), head.length);
      return Promise.resolve(plaintext);
    } catch {
      // Every failure reports identically, as WebCrypto does: distinguishing a
      // wrong key from a tampered tag would leak information.
      return Promise.reject(new DecryptionError());
    }
  },
};
