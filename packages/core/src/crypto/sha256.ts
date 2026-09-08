/**
 * SHA-256, HMAC and HKDF in plain TypeScript.
 *
 * React Native's Hermes engine has no `crypto.subtle`, so the WebCrypto provider
 * cannot run on the phone. Rather than pull in a native crypto module — another
 * dependency to build, another thing to break on an Android upgrade — the two
 * primitives actually needed for key derivation are implemented here.
 *
 * Rolling your own crypto is normally a bad idea. What makes it defensible: these
 * are hash constructions with published test vectors and no secret-dependent
 * branching, and the test suite checks every output against WebCrypto's
 * implementation. If they ever disagree, the tests fail.
 *
 * AES-GCM is deliberately NOT here. Encrypting real data belongs in a vetted
 * implementation, and on Android the bulk of it is done by SQLCipher natively.
 */

const K = /* @__PURE__ */ new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const BLOCK_SIZE = 64;
const HASH_SIZE = 32;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);

  // Padding: 0x80, zeros, then the length in bits as a 64-bit big-endian integer.
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  // Length is written as two 32-bit halves; a single 64-bit write would exceed
  // what a JS number can hold exactly for very large inputs.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  const lengthOffset = paddedLength - 8;
  padded[lengthOffset] = (high >>> 24) & 0xff;
  padded[lengthOffset + 1] = (high >>> 16) & 0xff;
  padded[lengthOffset + 2] = (high >>> 8) & 0xff;
  padded[lengthOffset + 3] = high & 0xff;
  padded[lengthOffset + 4] = (low >>> 24) & 0xff;
  padded[lengthOffset + 5] = (low >>> 16) & 0xff;
  padded[lengthOffset + 6] = (low >>> 8) & 0xff;
  padded[lengthOffset + 7] = low & 0xff;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  const out = new Uint8Array(HASH_SIZE);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i]! >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i]! >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i]! >>> 8) & 0xff;
    out[i * 4 + 3] = h[i]! & 0xff;
  }
  return out;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  // A key longer than the block size is hashed first, per RFC 2104.
  const shortened = key.length > BLOCK_SIZE ? sha256(key) : key;

  const inner = new Uint8Array(BLOCK_SIZE);
  const outer = new Uint8Array(BLOCK_SIZE);
  inner.set(shortened);
  outer.set(shortened);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] = inner[i]! ^ 0x36;
    outer[i] = outer[i]! ^ 0x5c;
  }

  const innerInput = new Uint8Array(BLOCK_SIZE + message.length);
  innerInput.set(inner);
  innerInput.set(message, BLOCK_SIZE);

  const outerInput = new Uint8Array(BLOCK_SIZE + HASH_SIZE);
  outerInput.set(outer);
  outerInput.set(sha256(innerInput), BLOCK_SIZE);

  return sha256(outerInput);
}

/** HKDF-Extract: condition input keying material into a pseudorandom key. */
export function hkdfExtract(salt: Uint8Array, keyMaterial: Uint8Array): Uint8Array {
  return hmacSha256(salt.length === 0 ? new Uint8Array(HASH_SIZE) : salt, keyMaterial);
}

/** HKDF-Expand: stretch a pseudorandom key into output of the requested length. */
export function hkdfExpand(
  pseudoRandomKey: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Uint8Array {
  const blocks = Math.ceil(lengthBytes / HASH_SIZE);
  if (blocks > 255) {
    throw new Error('HKDF cannot produce more than 255 blocks of output.');
  }

  const out = new Uint8Array(blocks * HASH_SIZE);
  // Typed from the function rather than as a bare Uint8Array: TypeScript 6 made
  // the buffer a type parameter, and the app builds with a newer compiler than
  // this package does.
  let previous: ReturnType<typeof hmacSha256> = new Uint8Array(0);

  for (let i = 0; i < blocks; i++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous);
    input.set(info, previous.length);
    input[input.length - 1] = i + 1;

    previous = hmacSha256(pseudoRandomKey, input);
    out.set(previous, i * HASH_SIZE);
  }

  return out.subarray(0, lengthBytes);
}

/** Full HKDF, matching WebCrypto's deriveBits with an empty salt. */
export function hkdf(
  keyMaterial: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
  salt: Uint8Array = new Uint8Array(0),
): Uint8Array {
  return hkdfExpand(hkdfExtract(salt, keyMaterial), info, lengthBytes);
}

/**
 * PBKDF2-HMAC-SHA256.
 *
 * Present for completeness, but slow in JavaScript: a production iteration count
 * takes seconds on a phone. Passphrase unlock should use a native module; this is
 * a fallback and a reference implementation for the tests.
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Uint8Array {
  const blocks = Math.ceil(lengthBytes / HASH_SIZE);
  const out = new Uint8Array(blocks * HASH_SIZE);

  for (let block = 1; block <= blocks; block++) {
    const input = new Uint8Array(salt.length + 4);
    input.set(salt);
    input[salt.length] = (block >>> 24) & 0xff;
    input[salt.length + 1] = (block >>> 16) & 0xff;
    input[salt.length + 2] = (block >>> 8) & 0xff;
    input[salt.length + 3] = block & 0xff;

    let u = hmacSha256(password, input);
    const accumulated = new Uint8Array(u);

    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(password, u);
      for (let j = 0; j < HASH_SIZE; j++) accumulated[j] = accumulated[j]! ^ u[j]!;
    }

    out.set(accumulated, (block - 1) * HASH_SIZE);
  }

  return out.subarray(0, lengthBytes);
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
