/**
 * Carrying files between devices.
 *
 * The point of these is that the *bytes* travel, and that they travel as
 * ciphertext the folder cannot read — the sync layer never holds a file key, so
 * what it copies must be exactly what the device stored.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { webCryptoProvider as provider } from '../crypto/webcrypto.js';
import { DocumentRepository } from '../documents/repository.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { MemoryBackend } from './backend.js';
import { SyncEngine } from './engine.js';
import { fileObjectKey, parseFileObjectKey, type LocalFileStore } from './files.js';

const OPLOG_KEY = provider.randomBytes(32);

/** Stands in for a device's encrypted-file directory. */
class MemoryFileStore implements LocalFileStore {
  private readonly blobs = new Map<string, Uint8Array>();

  has(fileId: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(fileId));
  }

  read(fileId: string): Promise<Uint8Array> {
    const value = this.blobs.get(fileId);
    if (!value) return Promise.reject(new Error(`no local file ${fileId}`));
    return Promise.resolve(value.slice());
  }

  write(fileId: string, sealed: Uint8Array): Promise<void> {
    this.blobs.set(fileId, sealed.slice());
    return Promise.resolve();
  }

  remove(fileId: string): Promise<void> {
    this.blobs.delete(fileId);
    return Promise.resolve();
  }

  /** Test helper: put bytes there as an import on this device would. */
  seed(fileId: string, sealed: Uint8Array): void {
    this.blobs.set(fileId, sealed.slice());
  }

  peek(fileId: string): Uint8Array | undefined {
    return this.blobs.get(fileId);
  }
}

function newDevice(name: string, backend: MemoryBackend) {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device: name });
  const files = new MemoryFileStore();
  const engine = new SyncEngine({ store, backend, provider, oplogKey: OPLOG_KEY, files });
  return { store, files, engine, documents: new DocumentRepository(store) };
}

/** What the per-file encryption would have produced; opaque to everything here. */
const SEALED = new Uint8Array([0xa7, 0x00, 0x13, 0xff, 0x42, 0x99]);

describe('file object keys', () => {
  it('round-trips an id', () => {
    expect(parseFileObjectKey(fileObjectKey('f_1'))).toBe('f_1');
  });

  it('ignores keys that are not files', () => {
    expect(parseFileObjectKey('oplog/dev_a/000000.seg.enc')).toBeNull();
    expect(parseFileObjectKey('keyfile.json')).toBeNull();
  });
});

describe('files between two devices', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  it('carries a scan from the device that took it to the one that did not', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    const file = phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    phone.documents.addDocument({ title: 'Passport', fileId: file.id });
    phone.files.seed(file.id, SEALED);

    const pushed = await phone.engine.sync();
    expect(pushed.uploadedFiles).toBe(1);

    const pulled = await desktop.engine.sync();

    expect(pulled.downloadedFiles).toBe(1);
    expect(desktop.documents.getDocument(phone.documents.listDocuments()[0]!.id)?.title).toBe(
      'Passport',
    );
    expect(Array.from(desktop.files.peek('f1')!)).toEqual(Array.from(SEALED));
  });

  it('copies the ciphertext through untouched', async () => {
    const phone = newDevice('dev_phone', backend);
    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    phone.files.seed('f1', SEALED);

    await phone.engine.sync();

    // What sits in the folder is exactly what the device stored: sync holds no
    // file key and must not be re-wrapping anything.
    expect(Array.from(backend.raw(fileObjectKey('f1'))!)).toEqual(Array.from(SEALED));
  });

  it('does not upload the same file twice', async () => {
    const phone = newDevice('dev_phone', backend);
    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    phone.files.seed('f1', SEALED);

    await phone.engine.sync();
    const second = await phone.engine.sync();

    expect(second.uploadedFiles).toBe(0);
  });

  it('does not re-download a file it already holds', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    phone.files.seed('f1', SEALED);
    await phone.engine.sync();

    await desktop.engine.sync();
    const second = await desktop.engine.sync();

    expect(second.downloadedFiles).toBe(0);
  });

  it('reports a record whose bytes have not been uploaded yet', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    // The record syncs immediately; the phone has not pushed the bytes because
    // this run captures the state between the two.
    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    phone.documents.addDocument({ title: 'Passport', fileId: 'f1' });
    await phone.engine.push();

    const report = await desktop.engine.sync();

    // Not an error and not loss: the other device simply has not sent them.
    expect(report.awaitingFiles).toBe(1);
    expect(report.downloadedFiles).toBe(0);
  });

  it('removes the bytes everywhere when the document is deleted', async () => {
    const phone = newDevice('dev_phone', backend);
    const desktop = newDevice('dev_desktop', backend);

    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    const document = phone.documents.addDocument({ title: 'Passport', fileId: 'f1' });
    phone.files.seed('f1', SEALED);

    await phone.engine.sync();
    await desktop.engine.sync();
    expect(desktop.files.peek('f1')).toBeDefined();

    phone.documents.deleteDocument(document.id);
    const removal = await phone.engine.sync();

    expect(removal.removedFiles).toBe(1);
    expect(phone.files.peek('f1')).toBeUndefined();
    expect(backend.raw(fileObjectKey('f1'))).toBeUndefined();

    // And the other device drops its copy when it learns of the deletion,
    // rather than keeping the scan of a document that no longer exists.
    await desktop.engine.sync();
    expect(desktop.files.peek('f1')).toBeUndefined();
  });

  it('keeps a file that another document still points at', async () => {
    const phone = newDevice('dev_phone', backend);

    phone.documents.addFile({ encryptedPath: 'vault-files/f1.enc', id: 'f1' });
    const first = phone.documents.addDocument({ title: 'Passport', fileId: 'f1' });
    phone.documents.addDocument({ title: 'Passport, second copy', fileId: 'f1' });
    phone.files.seed('f1', SEALED);
    await phone.engine.sync();

    phone.documents.deleteDocument(first.id);
    const report = await phone.engine.sync();

    expect(report.removedFiles).toBe(0);
    expect(phone.files.peek('f1')).toBeDefined();
  });

  it('syncs records as before when the device stores no files', async () => {
    const db = openTestDatabase();
    const store = VaultStore.open({ db, device: 'dev_reader' });
    const engine = new SyncEngine({ store, backend, provider, oplogKey: OPLOG_KEY });

    const phone = newDevice('dev_phone', backend);
    phone.documents.addDocument({ title: 'Contract' });
    await phone.engine.sync();

    const report = await engine.sync();

    expect(report.appliedEvents).toBeGreaterThan(0);
    expect(report.downloadedFiles).toBe(0);
  });
});
