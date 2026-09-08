import { beforeEach, describe, expect, it } from 'vitest';
import { toBase64, utf8ToBytes } from '../crypto/base64.js';
import { DecryptionError } from '../crypto/types.js';
import { webCryptoProvider as provider } from '../crypto/webcrypto.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { parseAmount } from '../money/money.js';
import { MemoryBackend } from './backend.js';
import { SyncEngine } from './engine.js';
import { SEGMENT_VERSION, encodeSegment, segmentKey } from './segments.js';

/** One shared 32-byte oplog key, as both devices would derive from the passphrase. */
const OPLOG_KEY = provider.randomBytes(32);

function newDevice(name: string, backend: MemoryBackend, oplogKey = OPLOG_KEY) {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: name });
  const engine = new SyncEngine({ store, backend, provider, oplogKey });
  return { store, engine, db };
}

function spend(store: VaultStore, id: string, amount: string, merchant: string) {
  store.commit('expense', id, {
    occurred_on: '2026-09-07',
    amount_minor: parseAmount(amount, 'TND').amountMinor,
    currency: 'TND',
    merchant,
  });
}

describe('two devices over shared storage', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  it('carries writes from one device to the other', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();
    await desktop.engine.sync();

    expect(desktop.store.read('expense', 'e1')?.amount_minor).toBe(4500);
    expect(desktop.store.read('expense', 'e1')?.merchant).toBe('Cafe');
  });

  it('converges when both wrote while offline', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    spend(desktop.store, 'e2', '71.250', 'Claude');

    // Each syncs once, unaware of the other; then once more.
    await phone.engine.sync();
    await desktop.engine.sync();
    await phone.engine.sync();

    for (const device of [phone, desktop]) {
      expect(device.store.read('expense', 'e1')?.amount_minor).toBe(4500);
      expect(device.store.read('expense', 'e2')?.amount_minor).toBe(71250);
    }
  });

  it('merges concurrent edits to different fields of one row', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();
    await desktop.engine.sync();

    phone.store.commit('expense', 'e1', { amount_minor: 5000 });
    desktop.store.commit('expense', 'e1', { note: 'with a croissant' });

    await phone.engine.sync();
    await desktop.engine.sync();
    await phone.engine.sync();

    for (const device of [phone, desktop]) {
      const row = device.store.read('expense', 'e1');
      expect(row?.amount_minor).toBe(5000);
      expect(row?.note).toBe('with a croissant');
    }
  });

  it('propagates a deletion', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();
    await desktop.engine.sync();

    phone.store.remove('expense', 'e1');
    await phone.engine.sync();
    await desktop.engine.sync();

    expect(desktop.store.read('expense', 'e1')).toBeUndefined();
    // The history survives on both sides.
    expect(desktop.store.historyOf('expense', 'e1')).toHaveLength(2);
  });
});

describe('what the cloud provider can see', () => {
  it('stores ciphertext only', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);

    spend(phone.store, 'e1', '4.500', 'Carrefour');
    await phone.engine.sync();

    const stored = backend.raw(segmentKey('dev_phone', 0))!;
    const asText = String.fromCharCode(...stored);

    for (const secret of ['Carrefour', 'expense', '4500', 'occurred_on', 'TND']) {
      expect(asText).not.toContain(secret);
    }
  });

  it('reveals nothing without the key', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();

    // Someone with full access to the cloud folder, but not the passphrase.
    const intruder = newDevice('dev_intruder', backend, provider.randomBytes(32));

    await expect(intruder.engine.pull()).rejects.toThrow(DecryptionError);
    expect(intruder.store.read('expense', 'e1')).toBeUndefined();
  });

  it('refuses a segment moved into another device directory', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();

    // Replay one device's history as though the other had written it.
    const stolen = backend.raw(segmentKey('dev_phone', 0))!;
    await backend.put(segmentKey('dev_desktop', 0), stolen);

    const fresh = newDevice('dev_fresh', backend);
    await expect(fresh.engine.pull()).rejects.toThrow(DecryptionError);
  });
});

describe('interruption and retries', () => {
  it('does nothing on a second sync with no changes', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();

    const report = await phone.engine.sync();
    expect(report.pushedSegments).toBe(0);
    expect(report.pulledSegments).toBe(0);
  });

  it('does not re-download a segment it has already applied', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();
    await desktop.engine.sync();

    const before = backend.calls.get;
    await desktop.engine.sync();
    expect(backend.calls.get).toBe(before);
  });

  it('recovers when a push uploaded but the local mark never happened', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');

    // Simulate dying between put and markUploaded: the segment is in the cloud,
    // but the events are still queued locally.
    const pending = phone.store.pendingUploads();
    await backend.put(
      segmentKey('dev_phone', 0),
      await encodeSegment(provider, OPLOG_KEY, {
        version: SEGMENT_VERSION,
        device: 'dev_phone',
        seq: 0,
        events: pending,
      }),
    );

    // The retry uploads the same events again as a new segment.
    const report = await phone.engine.push();
    expect(report.pushedSegments).toBe(1);
    expect(backend.keys()).toHaveLength(2);

    // Duplicate delivery is harmless: the row is correct and recorded once.
    await desktop.engine.pull();
    expect(desktop.store.read('expense', 'e1')?.amount_minor).toBe(4500);
    expect(desktop.store.historyOf('expense', 'e1')).toHaveLength(1);
  });

  it('resumes from the cursor after a failed pull', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();
    await desktop.engine.sync();

    spend(phone.store, 'e2', '12.000', 'Taxi');
    await phone.engine.sync();

    // Second pull picks up only the new segment.
    const report = await desktop.engine.pull();
    expect(report.pulledSegments).toBe(1);
    expect(desktop.store.read('expense', 'e2')?.amount_minor).toBe(12000);
  });

  it('reports how many events were genuinely new', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    spend(phone.store, 'e1', '4.500', 'Cafe');
    spend(phone.store, 'e2', '12.000', 'Taxi');
    await phone.engine.sync();

    const first = await desktop.engine.pull();
    expect(first.pulledEvents).toBe(2);
    expect(first.appliedEvents).toBe(2);

    // Force a re-read of the same segment by clearing the cursor.
    desktop.db.run('DELETE FROM sync_cursor');
    const second = await desktop.engine.pull();
    expect(second.pulledEvents).toBe(2);
    expect(second.appliedEvents).toBe(0);
  });
});

describe('restoring onto a new device', () => {
  it('rebuilds the whole vault from cloud storage', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    phone.store.commit('category', 'food', { name: 'Food', monthly_limit_minor: 400000 });
    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();

    spend(desktop.store, 'e2', '71.250', 'Claude');
    await desktop.engine.sync();
    await phone.engine.sync();

    // Phone lost. New install, new device id, same passphrase.
    const replacement = newDevice('dev_new_phone', backend);
    await replacement.engine.sync();

    expect(replacement.store.read('expense', 'e1')?.merchant).toBe('Cafe');
    expect(replacement.store.read('expense', 'e2')?.merchant).toBe('Claude');
    expect(replacement.store.read('category', 'food')?.monthly_limit_minor).toBe(400000);
  });

  it('does not re-upload events it restored from someone else', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    spend(phone.store, 'e1', '4.500', 'Cafe');
    await phone.engine.sync();

    const replacement = newDevice('dev_new_phone', backend);
    await replacement.engine.sync();

    expect(replacement.store.pendingUploads()).toHaveLength(0);
    expect(backend.keys().filter((key) => key.includes('dev_new_phone'))).toHaveLength(0);
  });

  it('numbers segments from the cloud, so a reinstall cannot overwrite its own history', async () => {
    const backend = new MemoryBackend();
    const first = newDevice('dev_phone', backend);
    spend(first.store, 'e1', '4.500', 'Cafe');
    await first.engine.sync();

    // Same device id, fresh local database — as after a reinstall from backup.
    const reinstalled = newDevice('dev_phone', backend);
    spend(reinstalled.store, 'e2', '12.000', 'Taxi');
    await reinstalled.engine.push();

    expect(backend.keys()).toEqual([
      segmentKey('dev_phone', 0),
      segmentKey('dev_phone', 1),
    ]);
  });
});

describe('keyfile publication', () => {
  it('publishes once and never overwrites', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);

    expect(await phone.engine.publishKeyfile('{"version":1}')).toBe(true);
    expect(await phone.engine.publishKeyfile('{"version":1,"other":true}')).toBe(false);
    expect(await phone.engine.fetchKeyfile()).toBe('{"version":1}');
  });

  it('reports an empty cloud folder rather than failing', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    expect(await phone.engine.fetchKeyfile()).toBeUndefined();
  });

  it('stores the keyfile as readable JSON, since it holds only wrapped keys', async () => {
    const backend = new MemoryBackend();
    const phone = newDevice('dev_phone', backend);
    await phone.engine.publishKeyfile('{"version":1}');

    const raw = backend.raw('keyfile.json')!;
    expect(toBase64(raw)).toBe(toBase64(utf8ToBytes('{"version":1}')));
  });
});
