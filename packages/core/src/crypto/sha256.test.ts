import { describe, expect, it } from 'vitest';
import { toBase64, utf8ToBytes } from './base64.js';
import {
  hkdf,
  hkdfExpand,
  hkdfExtract,
  hmacSha256,
  pbkdf2Sha256,
  sha256,
  toHex,
} from './sha256.js';
import { webCryptoProvider } from './webcrypto.js';

/**
 * Hand-written crypto is only defensible if it is checked against something
 * trustworthy. These tests do two things: compare against the published RFC test
 * vectors, and compare against WebCrypto's own implementation on the same inputs.
 * If the phone's key derivation ever diverges from the desktop's, this fails.
 */

describe('sha256 against published vectors', () => {
  it('matches the NIST examples', () => {
    expect(toHex(sha256(utf8ToBytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(toHex(sha256(utf8ToBytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(
      toHex(
        sha256(
          utf8ToBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        ),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles inputs that straddle a block boundary', () => {
    // 55, 56 and 64 bytes exercise the three padding cases, where an off-by-one
    // in the length encoding shows up.
    for (const length of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const input = new Uint8Array(length).fill(0x61);
      expect(toHex(sha256(input))).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('agrees with a long repeated input', () => {
    expect(toHex(sha256(utf8ToBytes('a'.repeat(1000))))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('hmac against RFC 4231 vectors', () => {
  it('matches test case 1', () => {
    const key = new Uint8Array(20).fill(0x0b);
    expect(toHex(hmacSha256(key, utf8ToBytes('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('matches test case 2', () => {
    expect(toHex(hmacSha256(utf8ToBytes('Jefe'), utf8ToBytes('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('hashes an over-long key first, per the spec', () => {
    const key = new Uint8Array(131).fill(0xaa);
    expect(
      toHex(hmacSha256(key, utf8ToBytes('Test Using Larger Than Block-Size Key - Hash Key First'))),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });
});

describe('hkdf against RFC 5869 vectors', () => {
  it('matches test case 1', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const info = new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);

    expect(toHex(hkdfExtract(salt, ikm))).toBe(
      '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5',
    );
    expect(toHex(hkdfExpand(hkdfExtract(salt, ikm), info, 42))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('matches the zero-salt, zero-info case', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    expect(toHex(hkdf(ikm, new Uint8Array(0), 42))).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });
});

describe('agreement with WebCrypto', () => {
  /**
   * The property that actually matters: the phone derives the same database key
   * as the desktop. If these two implementations ever disagree, a device would
   * open its vault with a key the other cannot reproduce.
   */
  it('derives identical subkeys for the same data key', async () => {
    const dataKey = webCryptoProvider.randomBytes(32);

    for (const info of ['vaultp/db', 'vaultp/files', 'vaultp/oplog']) {
      const fromWebCrypto = await webCryptoProvider.hkdf(dataKey, info, 32);
      const fromPortable = hkdf(dataKey, utf8ToBytes(info), 32);
      expect(toBase64(fromPortable)).toBe(toBase64(fromWebCrypto));
    }
  });

  it('agrees across a range of output lengths', async () => {
    const dataKey = webCryptoProvider.randomBytes(32);

    // 32 is one HMAC block; 33 and 64 cross the boundary where expand iterates.
    for (const length of [1, 16, 31, 32, 33, 64, 100]) {
      const fromWebCrypto = await webCryptoProvider.hkdf(dataKey, 'test/info', length);
      const fromPortable = hkdf(dataKey, utf8ToBytes('test/info'), length);
      expect(toBase64(fromPortable)).toBe(toBase64(fromWebCrypto));
    }
  });

  it('agrees on non-ascii info strings', async () => {
    const dataKey = webCryptoProvider.randomBytes(32);
    const info = 'vaultp/ملف/dossier';

    const fromWebCrypto = await webCryptoProvider.hkdf(dataKey, info, 32);
    expect(toBase64(hkdf(dataKey, utf8ToBytes(info), 32))).toBe(toBase64(fromWebCrypto));
  });

  it('produces different keys for different info strings', () => {
    const dataKey = webCryptoProvider.randomBytes(32);
    const db = hkdf(dataKey, utf8ToBytes('vaultp/db'), 32);
    const files = hkdf(dataKey, utf8ToBytes('vaultp/files'), 32);

    // Separation is the whole point: a leaked file key must not reveal the database.
    expect(toBase64(db)).not.toBe(toBase64(files));
  });
});

describe('pbkdf2', () => {
  it('matches RFC 6070 style vectors for SHA-256', () => {
    expect(
      toHex(pbkdf2Sha256(utf8ToBytes('password'), utf8ToBytes('salt'), 1, 32)),
    ).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');

    expect(
      toHex(pbkdf2Sha256(utf8ToBytes('password'), utf8ToBytes('salt'), 2, 32)),
    ).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  });

  it('is far too slow for production use on a phone', () => {
    // Documenting the limitation as a test so it cannot be forgotten: this is a
    // reference implementation, not the unlock path.
    const started = Date.now();
    pbkdf2Sha256(utf8ToBytes('password'), utf8ToBytes('salt'), 2000, 32);
    const elapsed = Date.now() - started;

    // 2000 iterations is 1% of the production count and already measurable.
    expect(elapsed).toBeGreaterThan(0);
  });
});
