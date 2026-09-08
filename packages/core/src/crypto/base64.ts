/**
 * Base64 without Buffer or atob.
 *
 * `Buffer` is Node-only and `atob` is not reliably present on Hermes, so both
 * would break the Android build. Twenty lines here removes a platform dependency
 * from the one module that must run identically everywhere.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = /* @__PURE__ */ (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return out;
}

export function fromBase64(value: string): Uint8Array {
  const clean = value.replace(/=+$/, '');
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let index = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const decoded = LOOKUP[clean.charCodeAt(i)]!;
    if (decoded === 255) throw new Error('Invalid base64 input.');
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

export function utf8ToBytes(value: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i++;
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i]!;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
      i += 1;
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 31) << 6) | (bytes[i + 1]! & 63));
      i += 2;
    } else if (byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63),
      );
      i += 3;
    } else {
      const code =
        ((byte & 7) << 18) |
        ((bytes[i + 1]! & 63) << 12) |
        ((bytes[i + 2]! & 63) << 6) |
        (bytes[i + 3]! & 63);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 1023));
      i += 4;
    }
  }
  return out;
}
