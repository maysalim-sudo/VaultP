/**
 * Segments: batches of events, encrypted, as they exist in cloud storage.
 *
 * Layout:
 *
 *   keyfile.json                        wrapped keys, the only plaintext object
 *   oplog/<device>/000001.seg.enc       written by that device and no other
 *   snapshots/<hlc>.snap.enc
 *   files/<file id>.enc
 *
 * One writer per directory is what removes conflict from the design: two devices
 * never write the same key, so no locking, no compare-and-swap, and no provider
 * feature beyond storing bytes is required.
 *
 * Segments are immutable once written. Sync therefore only ever appends and reads,
 * which is why an interrupted sync cannot corrupt anything.
 */

import { bytesToUtf8, utf8ToBytes } from '../crypto/base64.js';
import type { CryptoProvider } from '../crypto/types.js';
import { type VaultEvent, assertValidEvent } from '../oplog/event.js';

export const SEGMENT_VERSION = 1;
export const OPLOG_PREFIX = 'oplog/';
export const KEYFILE_KEY = 'keyfile.json';
/** Zero-padded so lexicographic key order matches numeric order. */
const SEQ_DIGITS = 6;

export interface Segment {
  readonly version: number;
  readonly device: string;
  readonly seq: number;
  readonly events: readonly VaultEvent[];
}

export class SegmentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentFormatError';
  }
}

export function segmentKey(device: string, seq: number): string {
  return `${OPLOG_PREFIX}${device}/${String(seq).padStart(SEQ_DIGITS, '0')}.seg.enc`;
}

export function parseSegmentKey(key: string): { device: string; seq: number } | null {
  const match = /^oplog\/([^/]+)\/(\d+)\.seg\.enc$/.exec(key);
  if (!match) return null;
  return { device: match[1]!, seq: Number(match[2]) };
}

export function devicePrefix(device: string): string {
  return `${OPLOG_PREFIX}${device}/`;
}

/**
 * Bind the ciphertext to its location.
 *
 * Without this, a segment could be copied from one device's directory into
 * another's and would still decrypt — letting anyone with write access to the
 * cloud folder replay one device's history as though it came from the other.
 */
function aadFor(device: string, seq: number): string {
  return `vaultp/segment/v${SEGMENT_VERSION}/${device}/${seq}`;
}

export function encodeSegment(
  provider: CryptoProvider,
  oplogKey: Uint8Array,
  segment: Segment,
): Promise<Uint8Array> {
  const payload = utf8ToBytes(JSON.stringify(segment));
  return provider.encrypt(oplogKey, payload, aadFor(segment.device, segment.seq));
}

export async function decodeSegment(
  provider: CryptoProvider,
  oplogKey: Uint8Array,
  device: string,
  seq: number,
  sealed: Uint8Array,
): Promise<Segment> {
  const plaintext = await provider.decrypt(oplogKey, sealed, aadFor(device, seq));

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytesToUtf8(plaintext));
  } catch {
    throw new SegmentFormatError(`Segment ${device}/${seq} is not valid JSON.`);
  }

  const segment = parsed as Partial<Segment>;
  if (segment.version !== SEGMENT_VERSION) {
    throw new SegmentFormatError(
      `Segment ${device}/${seq} uses format version ${String(segment.version)}, ` +
        `which this build does not understand.`,
    );
  }
  if (!Array.isArray(segment.events)) {
    throw new SegmentFormatError(`Segment ${device}/${seq} has no events array.`);
  }
  // The path said one device wrote this; the contents must agree.
  if (segment.device !== device) {
    throw new SegmentFormatError(
      `Segment at ${device}/${seq} claims to come from ${String(segment.device)}.`,
    );
  }
  for (const event of segment.events) assertValidEvent(event);

  return {
    version: segment.version,
    device: segment.device,
    seq: segment.seq ?? seq,
    events: segment.events,
  };
}
