/**
 * X25519 against the vectors published with the standard, and the sealed box
 * that carries a vault key from a phone to one computer and no other.
 */

import { describe, expect, it } from 'vitest';

import { utf8ToBytes } from './base64.js';
import { toHex } from './sha256.js';
import { DecryptionError } from './types.js';
import { webCryptoProvider as provider } from './webcrypto.js';
import { generateX25519KeyPair, openSealed, sealTo, x25519 } from './x25519.js';

const hex = (value: string) => new Uint8Array(value.match(/../g)!.map((byte) => parseInt(byte, 16)));

describe('X25519 (RFC 7748)', () => {
  it('matches the first test vector', () => {
    const scalar = hex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4');
    const point = hex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c');
    expect(toHex(x25519(scalar, point))).toBe('c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  });

  it('matches the second test vector', () => {
    const scalar = hex('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d');
    const point = hex('e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493');
    expect(toHex(x25519(scalar, point))).toBe('95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957');
  });

  it('matches the iterated vector after 1,000 rounds', () => {
    let k: Uint8Array = hex('0900000000000000000000000000000000000000000000000000000000000000');
    let u: Uint8Array = k;
    for (let round = 0; round < 1000; round += 1) {
      const next = x25519(k, u);
      u = k;
      k = next;
    }
    expect(toHex(k)).toBe('684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51');
  });

  it('gives both sides of the standard’s exchange the same secret', () => {
    const alicePrivate = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bobPrivate = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    const base = hex('0900000000000000000000000000000000000000000000000000000000000000');

    const alicePublic = x25519(alicePrivate, base);
    const bobPublic = x25519(bobPrivate, base);
    expect(toHex(alicePublic)).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(toHex(bobPublic)).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');

    const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(toHex(x25519(alicePrivate, bobPublic))).toBe(shared);
    expect(toHex(x25519(bobPrivate, alicePublic))).toBe(shared);
  });
});

describe('a box sealed to one device', () => {
  const secret = utf8ToBytes('the vault key');

  it('opens for the device it was sealed to', async () => {
    const computer = generateX25519KeyPair(provider);
    const sealed = await sealTo(provider, computer.publicKey, secret, 'vaultp/handoff/v1');
    expect(await openSealed(provider, computer, sealed, 'vaultp/handoff/v1')).toEqual(secret);
  });

  it('does not open for anyone else, even holding the public key', async () => {
    const computer = generateX25519KeyPair(provider);
    const stranger = generateX25519KeyPair(provider);
    const sealed = await sealTo(provider, computer.publicKey, secret, 'vaultp/handoff/v1');

    // What someone who photographed the QR code could try: they know the
    // public key, but have only their own private one.
    await expect(
      openSealed(provider, { privateKey: stranger.privateKey, publicKey: computer.publicKey }, sealed, 'vaultp/handoff/v1'),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('does not open if altered, or presented for another purpose', async () => {
    const computer = generateX25519KeyPair(provider);
    const sealed = await sealTo(provider, computer.publicKey, secret, 'vaultp/handoff/v1');

    const altered = sealed.slice();
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
    await expect(openSealed(provider, computer, altered, 'vaultp/handoff/v1')).rejects.toBeInstanceOf(DecryptionError);
    await expect(openSealed(provider, computer, sealed, 'something/else')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('never produces the same box twice', async () => {
    const computer = generateX25519KeyPair(provider);
    const a = await sealTo(provider, computer.publicKey, secret, 'x');
    const b = await sealTo(provider, computer.publicKey, secret, 'x');
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('refuses a degenerate public key', async () => {
    await expect(sealTo(provider, new Uint8Array(32), secret, 'x')).rejects.toBeInstanceOf(DecryptionError);
  });
});
