/**
 * Does a segment written by the phone open on the desktop?
 *
 * The two devices use different AES-GCM implementations — react-native-quick-crypto
 * on Android, WebCrypto on the desktop — and if their output layouts disagree by
 * so much as the position of the authentication tag, sync fails at the first pull
 * with an error that looks like corruption.
 *
 * The native module cannot run under Node, but `node:crypto` exposes the same
 * API and the mobile provider is written against it, so this reproduces the
 * mobile code path byte for byte and checks both directions. What is under test
 * is the framing — nonce, ciphertext, tag, associated data — which is where the
 * mistake would be. The ciphers themselves are standard.
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { toBase64, utf8ToBytes } from './base64.js';
import { deriveVaultKeys } from './subkeys.js';
import { DecryptionError, NONCE_LENGTH, type CryptoProvider } from './types.js';
import { webCryptoProvider } from './webcrypto.js';
import { hkdf } from './sha256.js';

const TAG_LENGTH = 16;

/**
 * The mobile provider, reproduced against node:crypto.
 *
 * Deliberately a copy of `apps/mobile/src/crypto/provider.ts` rather than an
 * import: that file imports React Native modules and cannot load here. If the two
 * ever drift, this test stops proving anything — which is why it says so.
 */
const mobileShapedProvider: CryptoProvider = {
  randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  },

  hkdf(key, info, lengthBytes) {
    // The portable implementation the phone uses, not WebCrypto's.
    return Promise.resolve(hkdf(key, utf8ToBytes(info), lengthBytes));
  },

  deriveFromPassphrase() {
    return Promise.reject(new Error('Not part of this test.'));
  },

  encrypt(key, plaintext, aad) {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(utf8ToBytes(aad)));

    const head = cipher.update(Buffer.from(plaintext));
    const rest = cipher.final();
    const tag = cipher.getAuthTag();

    const sealed = new Uint8Array(nonce.length + head.length + rest.length + tag.length);
    sealed.set(nonce, 0);
    sealed.set(new Uint8Array(head), nonce.length);
    sealed.set(new Uint8Array(rest), nonce.length + head.length);
    sealed.set(new Uint8Array(tag), nonce.length + head.length + rest.length);
    return Promise.resolve(sealed);
  },

  decrypt(key, sealed, aad) {
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
      return Promise.reject(new DecryptionError());
    }
  },
};

const KEY = new Uint8Array(32).fill(7);
const AAD = 'vaultp/segment/v1/dev_phone/0';

describe('phone and desktop agree on the ciphertext layout', () => {
  it('opens on the desktop what the phone sealed', async () => {
    const message = utf8ToBytes(JSON.stringify({ merchant: 'Cafe', amount_minor: 4500 }));

    const sealed = await mobileShapedProvider.encrypt(KEY, message, AAD);
    const opened = await webCryptoProvider.decrypt(KEY, sealed, AAD);

    expect(opened).toEqual(message);
  });

  it('opens on the phone what the desktop sealed', async () => {
    const message = utf8ToBytes('written on the desktop');

    const sealed = await webCryptoProvider.encrypt(KEY, message, AAD);
    const opened = await mobileShapedProvider.decrypt(KEY, sealed, AAD);

    expect(opened).toEqual(message);
  });

  it('produces the same total length from both', async () => {
    const message = utf8ToBytes('x'.repeat(1000));

    const fromPhone = await mobileShapedProvider.encrypt(KEY, message, AAD);
    const fromDesktop = await webCryptoProvider.encrypt(KEY, message, AAD);

    // nonce + ciphertext + tag. A difference here means one of them puts the tag
    // somewhere else, and every cross-device read would fail.
    expect(fromPhone.length).toBe(fromDesktop.length);
    expect(fromPhone.length).toBe(NONCE_LENGTH + message.length + TAG_LENGTH);
  });

  it('rejects a cross-device message whose associated data was changed', async () => {
    const sealed = await mobileShapedProvider.encrypt(KEY, utf8ToBytes('secret'), AAD);

    // A segment moved into another device's directory: the path is bound in, so
    // the desktop must refuse it rather than replay one device's history as the
    // other's.
    await expect(
      webCryptoProvider.decrypt(KEY, sealed, 'vaultp/segment/v1/dev_desktop/0'),
    ).rejects.toThrow(DecryptionError);
  });

  it('rejects a cross-device message with a flipped bit', async () => {
    const sealed = await mobileShapedProvider.encrypt(KEY, utf8ToBytes('secret'), AAD);
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 1;

    await expect(webCryptoProvider.decrypt(KEY, sealed, AAD)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('derives identical subkeys on both, from one data key', async () => {
    // The phone uses portable HKDF and the desktop uses WebCrypto's. If these
    // disagreed, the two would encrypt with different keys from the same
    // passphrase and neither could read the other.
    const dataKey = webCryptoProvider.randomBytes(32);

    const onPhone = await deriveVaultKeys(mobileShapedProvider, dataKey);
    const onDesktop = await deriveVaultKeys(webCryptoProvider, dataKey);

    expect(toBase64(onPhone.database)).toBe(toBase64(onDesktop.database));
    expect(toBase64(onPhone.files)).toBe(toBase64(onDesktop.files));
    expect(toBase64(onPhone.oplog)).toBe(toBase64(onDesktop.oplog));
  });

  it('round-trips a realistic segment in both directions', async () => {
    const segment = utf8ToBytes(
      JSON.stringify({
        version: 1,
        device: 'dev_phone',
        seq: 0,
        events: Array.from({ length: 50 }, (_, index) => ({
          id: `0199c0a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
          hlc: `000001700000000${index}|00000|dev_phone`,
          device: 'dev_phone',
          entity: 'expense',
          entityId: `e${index}`,
          op: 'put',
          fields: { amount_minor: 4500 + index, currency: 'TND' },
          schemaVersion: 1,
        })),
      }),
    );

    const sealed = await mobileShapedProvider.encrypt(KEY, segment, AAD);
    expect(await webCryptoProvider.decrypt(KEY, sealed, AAD)).toEqual(segment);
  });
});
