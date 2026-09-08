/**
 * The sync cycle: push what we wrote, pull what the other device wrote.
 *
 * Correctness rests on three properties established elsewhere in core:
 *
 *   1. One writer per directory, so no two devices ever write the same object.
 *   2. Events merge by hybrid logical clock, so the order segments arrive in does
 *      not affect the result.
 *   3. Applying an event twice is a no-op, so retries are free.
 *
 * Together those make sync interruption-safe. There is no half-applied state to
 * repair: a sync that dies mid-way has simply applied fewer events, and the next
 * run continues. Nothing here needs a rollback path.
 */

import type { CryptoProvider } from '../crypto/types.js';
import type { VaultStore } from '../db/store.js';
import type { VaultEvent } from '../oplog/event.js';
import type { StorageBackend } from './backend.js';
import { ObjectNotFoundError } from './backend.js';
import {
  KEYFILE_KEY,
  OPLOG_PREFIX,
  SEGMENT_VERSION,
  decodeSegment,
  devicePrefix,
  encodeSegment,
  parseSegmentKey,
  segmentKey,
} from './segments.js';
import { bytesToUtf8, utf8ToBytes } from '../crypto/base64.js';
import {
  EMPTY_FILE_REPORT,
  syncFiles,
  type FileSyncReport,
  type LocalFileStore,
} from './files.js';

export interface SyncEngineOptions {
  readonly store: VaultStore;
  readonly backend: StorageBackend;
  readonly provider: CryptoProvider;
  /** Derived from the data key; the backend never sees it. */
  readonly oplogKey: Uint8Array;
  /** Events per segment. Small enough to upload over a poor connection. */
  readonly batchSize?: number;
  /**
   * Where this device keeps its encrypted files.
   *
   * Optional because the oplog is the vault and files are an addition to it: a
   * caller with nothing to store — a test, or a device that only reads records —
   * syncs without one and simply moves no bytes.
   */
  readonly files?: LocalFileStore;
}

export interface SyncReport extends FileSyncReport {
  readonly pushedEvents: number;
  readonly pushedSegments: number;
  readonly pulledSegments: number;
  readonly pulledEvents: number;
  /** Events that were new to this device; the rest were already known. */
  readonly appliedEvents: number;
}

const EMPTY_REPORT: SyncReport = {
  pushedEvents: 0,
  pushedSegments: 0,
  pulledSegments: 0,
  pulledEvents: 0,
  appliedEvents: 0,
  ...EMPTY_FILE_REPORT,
};

/**
 * Read the keyfile from storage without an open vault.
 *
 * A second device needs this before it can have a vault at all: the data key is
 * random rather than derived from the passphrase, so it has to be handed over —
 * wrapped, which is what the keyfile is. Standalone because at this point there
 * is no store, no key and nothing to sync.
 */
export async function fetchKeyfileFrom(
  backend: StorageBackend,
): Promise<string | undefined> {
  try {
    return bytesToUtf8(await backend.get(KEYFILE_KEY));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return undefined;
    throw error;
  }
}

export class SyncEngine {
  private readonly store: VaultStore;
  private readonly backend: StorageBackend;
  private readonly provider: CryptoProvider;
  private readonly oplogKey: Uint8Array;
  private readonly batchSize: number;
  private readonly files: LocalFileStore | undefined;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.backend = options.backend;
    this.provider = options.provider;
    this.oplogKey = options.oplogKey;
    this.batchSize = options.batchSize ?? 250;
    this.files = options.files;
  }

  /** Push then pull, so our own writes are safe in the cloud before we merge. */
  async sync(): Promise<SyncReport> {
    const pushed = await this.push();
    const pulled = await this.pull();

    // Files last, and only after the merge: the file table has to reflect what
    // both devices know before it is any use deciding which bytes are missing
    // here and which rows were deleted elsewhere.
    const files = this.files
      ? await syncFiles({ store: this.store, backend: this.backend, files: this.files })
      : EMPTY_FILE_REPORT;

    return { ...pushed, ...pulled, ...files };
  }

  // ------------------------------------------------------------------- push

  async push(): Promise<Pick<SyncReport, 'pushedEvents' | 'pushedSegments'>> {
    let seq = await this.nextSequenceNumber();
    let pushedEvents = 0;
    let pushedSegments = 0;

    for (;;) {
      const events = this.store.pendingUploads(this.batchSize);
      if (events.length === 0) break;

      const key = segmentKey(this.store.device, seq);
      const sealed = await encodeSegment(this.provider, this.oplogKey, {
        version: SEGMENT_VERSION,
        device: this.store.device,
        seq,
        events,
      });

      // Upload first, mark second. Dying in between re-uploads these events in a
      // later segment, which is harmless because ingest is idempotent. Marking
      // first would risk losing events that never reached the cloud.
      await this.backend.put(key, sealed);
      this.store.markUploaded(events.map((event) => event.id));

      pushedEvents += events.length;
      pushedSegments += 1;
      seq += 1;
    }

    return { pushedEvents, pushedSegments };
  }

  /**
   * Next free segment number, taken from the cloud rather than a local counter.
   *
   * A local counter would collide after a restore: the reinstalled app would start
   * from zero and overwrite its own earlier segments.
   */
  private async nextSequenceNumber(): Promise<number> {
    const existing = await this.backend.list(devicePrefix(this.store.device));
    let highest = -1;
    for (const object of existing) {
      const parsed = parseSegmentKey(object.key);
      if (parsed && parsed.seq > highest) highest = parsed.seq;
    }
    return highest + 1;
  }

  // ------------------------------------------------------------------- pull

  async pull(): Promise<
    Pick<SyncReport, 'pulledSegments' | 'pulledEvents' | 'appliedEvents'>
  > {
    const objects = await this.backend.list(OPLOG_PREFIX);
    const cursors = this.readCursors();

    let pulledSegments = 0;
    let pulledEvents = 0;
    let appliedEvents = 0;

    for (const object of objects) {
      const parsed = parseSegmentKey(object.key);
      if (!parsed) continue;
      // Our own segments are already in the local log.
      if (parsed.device === this.store.device) continue;
      // Keys are zero-padded, so a string comparison is a sequence comparison.
      if ((cursors.get(parsed.device) ?? '') >= object.key) continue;

      let sealed: Uint8Array;
      try {
        sealed = await this.backend.get(object.key);
      } catch (error) {
        // Listed but gone: a concurrent delete, or an eventually-consistent
        // provider. Skip it; the cursor does not advance, so it is retried.
        if (error instanceof ObjectNotFoundError) continue;
        throw error;
      }

      const segment = await decodeSegment(
        this.provider,
        this.oplogKey,
        parsed.device,
        parsed.seq,
        sealed,
      );

      appliedEvents += this.store.ingest(segment.events);
      pulledEvents += segment.events.length;
      pulledSegments += 1;

      // Advance only after the events are committed, so a crash re-fetches this
      // segment rather than skipping it.
      this.writeCursor(parsed.device, object.key);
    }

    return { pulledSegments, pulledEvents, appliedEvents };
  }

  // ---------------------------------------------------------------- keyfile

  /**
   * Publish the keyfile so another device can bootstrap from the passphrase alone.
   * Never overwritten: rewrapping is a deliberate act, not a sync side effect.
   */
  async publishKeyfile(serialized: string): Promise<boolean> {
    const existing = await this.backend.list(KEYFILE_KEY);
    if (existing.length > 0) return false;
    await this.backend.put(KEYFILE_KEY, utf8ToBytes(serialized));
    return true;
  }

  fetchKeyfile(): Promise<string | undefined> {
    return fetchKeyfileFrom(this.backend);
  }

  // ---------------------------------------------------------------- cursors

  private readCursors(): Map<string, string> {
    const rows = this.store.database.all<{ device: string; last_segment: string }>(
      'SELECT device, last_segment FROM sync_cursor',
    );
    return new Map(rows.map((row) => [row.device, row.last_segment]));
  }

  private writeCursor(device: string, key: string): void {
    this.store.database.run(
      `INSERT INTO sync_cursor (device, last_segment) VALUES (?, ?)
       ON CONFLICT(device) DO UPDATE SET last_segment = excluded.last_segment`,
      [device, key],
    );
  }
}

export { EMPTY_REPORT };
export type { VaultEvent };
