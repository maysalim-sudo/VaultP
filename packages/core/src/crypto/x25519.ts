/**
 * X25519 key agreement (RFC 7748), and a sealed box built on it.
 *
 * WHY THIS EXISTS. Handing a vault key from an unlocked phone to a computer
 * needs encryption that only *that computer* can undo. The pairing secret is
 * not enough for this: it is printed in a QR code, and anyone who photographed
 * the code would hold it. A public key in the QR code is different — seeing it
 * helps nobody. The computer makes a key pair for one unlock, shows the public
 * half, and keeps the private half in memory; what the phone seals to it can be
 * opened nowhere else, photographed code or not.
 *
 * WHY IT IS WRITTEN HERE. Both platforms need the identical operation, and the
 * phone's native crypto module does not reliably expose it. The curve
 * arithmetic is small and has published test vectors, which the tests check.
 * It uses BigInt and is not constant-time; the keys it handles are made for a
 * single exchange between two devices on a local network and discarded, which
 * is not a setting where timing can be measured and used.
 */

import { utf8ToBytes } from './base64.js';
import { hkdf } from './sha256.js';
import { type CryptoProvider, DecryptionError } from './types.js';

export const X25519_KEY_LENGTH = 32;

const P = (1n << 255n) - 19n;
const A24 = 121665n;

const mod = (value: bigint): bigint => {
  const result = value % P;
  return result >= 0n ? result : result + P;
};

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    remaining >>= 1n;
  }
  return result;
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!);
  return value;
}

function encodeLittleEndian(value: bigint): Uint8Array {
  const out = new Uint8Array(X25519_KEY_LENGTH);
  let remaining = value;
  for (let index = 0; index < X25519_KEY_LENGTH; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/** The scalar multiplication at the heart of X25519: `scalar · point`. */
export function x25519(scalar: Uint8Array, point: Uint8Array): Uint8Array {
  if (scalar.length !== X25519_KEY_LENGTH || point.length !== X25519_KEY_LENGTH) {
    throw new Error('X25519 keys are 32 bytes.');
  }

  // Clamp the scalar, as the RFC requires.
  const clamped = scalar.slice();
  clamped[0] = clamped[0]! & 248;
  clamped[31] = (clamped[31]! & 127) | 64;
  const k = decodeLittleEndian(clamped);

  // The top bit of the point is ignored.
  const masked = point.slice();
  masked[31] = masked[31]! & 127;
  const x1 = mod(decodeLittleEndian(masked));

  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t -= 1) {
    const bit = (k >> BigInt(t)) & 1n;
    swap ^= bit;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = bit;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) * (da + cb));
    z3 = mod(x1 * mod((da - cb) * (da - cb)));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }

  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  return encodeLittleEndian(mod(x2 * power(z2, P - 2n)));
}

const BASE_POINT = (() => {
  const base = new Uint8Array(X25519_KEY_LENGTH);
  base[0] = 9;
  return base;
})();

export interface X25519KeyPair {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

export function generateX25519KeyPair(provider: Pick<CryptoProvider, 'randomBytes'>): X25519KeyPair {
  const privateKey = provider.randomBytes(X25519_KEY_LENGTH);
  return { privateKey, publicKey: x25519(privateKey, BASE_POINT) };
}

async function sealingKey(
  shared: Uint8Array,
  ephemeralPublic: Uint8Array,
  recipientPublic: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  // An all-zero result means the other side supplied a degenerate point; a key
  // derived from it would be the same for everyone.
  if (shared.every((byte) => byte === 0)) throw new DecryptionError('The key exchange was not valid.');

  const salt = new Uint8Array(X25519_KEY_LENGTH * 2);
  salt.set(ephemeralPublic);
  salt.set(recipientPublic, X25519_KEY_LENGTH);
  // Both public keys are bound in, so a box sealed for one recipient cannot be
  // presented as sealed for another.
  return hkdf(shared, utf8ToBytes(context), 32, salt);
}

/**
 * Encrypt so that only the holder of `recipientPublic`'s private key can read it.
 *
 * Output: the sender's one-time public key, then AES-256-GCM ciphertext.
 * `context` names what this is for, and must match on opening.
 */
export async function sealTo(
  provider: CryptoProvider,
  recipientPublic: Uint8Array,
  plaintext: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  const ephemeral = generateX25519KeyPair(provider);
  const key = await sealingKey(
    x25519(ephemeral.privateKey, recipientPublic),
    ephemeral.publicKey,
    recipientPublic,
    context,
  );
  const body = await provider.encrypt(key, plaintext, context);

  const out = new Uint8Array(X25519_KEY_LENGTH + body.length);
  out.set(ephemeral.publicKey);
  out.set(body, X25519_KEY_LENGTH);
  return out;
}

/** Throws DecryptionError if this is not the intended recipient, or it was altered. */
export async function openSealed(
  provider: CryptoProvider,
  recipient: X25519KeyPair,
  sealed: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  if (sealed.length <= X25519_KEY_LENGTH) throw new DecryptionError();
  const ephemeralPublic = sealed.subarray(0, X25519_KEY_LENGTH);
  const key = await sealingKey(
    x25519(recipient.privateKey, ephemeralPublic),
    ephemeralPublic,
    recipient.publicKey,
    context,
  );
  return provider.decrypt(key, sealed.subarray(X25519_KEY_LENGTH), context);
}
