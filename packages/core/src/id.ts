/**
 * UUIDv7 identifiers: a 48-bit millisecond timestamp followed by randomness.
 *
 * Chosen over UUIDv4 because ids are generated independently on two offline
 * devices and must still be collision-free, while sorting in creation order so
 * they work as SQLite primary keys without a separate sequence and without
 * fragmenting the B-tree on insert.
 */

const UUID_BYTES = 16;
/** 12 bits of sub-millisecond sequence live in rand_a. */
const MAX_SEQ = 0xfff;

let lastMs = -1;
let seq = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Generate a UUIDv7. Monotonic within a process: ids minted in the same
 * millisecond still sort in the order they were created, so a burst of writes
 * keeps a stable order in the event log.
 *
 * `now` is a floor, not an override. A value at or below the last timestamp used
 * is clamped forward, because emitting an id that sorts before one already issued
 * would break the ordering the event log depends on. Passing an explicit `now` is
 * therefore only meaningful for a time at or after the previous call.
 */
export function uuidv7(now: number = Date.now()): string {
  let timestamp = now;

  if (timestamp > lastMs) {
    lastMs = timestamp;
    seq = 0;
  } else {
    // Clock stalled or stepped backwards: keep our own timestamp moving forward
    // rather than emitting an id that sorts before one already issued.
    timestamp = lastMs;
    seq += 1;
    if (seq > MAX_SEQ) {
      lastMs += 1;
      timestamp = lastMs;
      seq = 0;
    }
  }

  const bytes = randomBytes(UUID_BYTES);

  // 48-bit big-endian timestamp.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble, sequence in the remaining 12 bits.
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;

  // RFC 4122 variant bits.
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = toHex(bytes);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** Milliseconds encoded in a UUIDv7, for debugging and for snapshot bounds. */
export function timestampOf(uuid: string): number {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}

/**
 * A stable per-installation device id. Used to namespace the device's oplog
 * directory in cloud storage and to break ties in the hybrid logical clock, so
 * it must never be shared between two installs.
 */
export function newDeviceId(): string {
  return `dev_${toHex(randomBytes(6))}`;
}
