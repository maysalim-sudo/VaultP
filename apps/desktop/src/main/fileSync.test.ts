/**
 * A scan crossing between two vaults through a folder.
 *
 * The core tests prove the sync logic with stand-in bytes. This one uses the
 * real thing end to end: a real file encrypted by the real file store, pushed
 * through a real folder backend, pulled into a second vault that never saw the
 * original, and decrypted there. If the two sides ever disagree about the path
 * shape, the per-file key derivation or the additional data, this is what
 * notices.
 *
 * The folder is also inspected directly, because the claim is not only that the
 * bytes arrive — it is that whatever keeps that folder in step never sees
 * anything readable.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DocumentRepository,
  SyncEngine,
  VaultStore,
  createVault,
  deriveVaultKeys,
  fileObjectKey,
  toSqlCipherKey,
  webCryptoProvider,
  type VaultKeys,
} from '@vaultp/core';

import { openDesktopDatabase } from './db.js';
import { FolderBackend } from './folderBackend.js';
import { decryptFile, desktopFileStore, importFile } from './fileStore.js';

const scratch: string[] = [];
const open: Array<{ close: () => void }> = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'vaultp-filesync-'));
  scratch.push(created);
  return created;
}

/** A device: its own vault root, its own database, one shared data key. */
async function newDevice(name: string, keys: VaultKeys, folder: string) {
  const root = await directory();
  const db = openDesktopDatabase({
    path: join(root, 'vaultp.db'),
    encryptionKey: toSqlCipherKey(keys.database),
  });
  open.push(db as unknown as { close: () => void });

  const store = VaultStore.open({ db, device: name });
  const engine = new SyncEngine({
    store,
    backend: new FolderBackend(folder),
    provider: webCryptoProvider,
    oplogKey: keys.oplog,
    files: desktopFileStore(root),
  });

  return { root, store, engine, documents: new DocumentRepository(store) };
}

afterEach(async () => {
  // Windows will not delete a directory while a database in it is open.
  for (const db of open.splice(0)) db.close();
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('a scan crossing between two vaults', () => {
  it('arrives on the far side and decrypts to the same bytes', async () => {
    const folder = await directory();
    const created = await createVault(webCryptoProvider, { passphrase: 'correct horse battery' });
    const keys = await deriveVaultKeys(webCryptoProvider, created.dataKey);

    const first = await newDevice('dev_first', keys, folder);
    const second = await newDevice('dev_second', keys, folder);

    // Something recognisable, so a truncated or re-wrapped copy is obvious.
    const plaintext = new Uint8Array(4096);
    for (let i = 0; i < plaintext.length; i += 1) plaintext[i] = (i * 7) % 251;

    const source = join(first.root, 'passport.jpg');
    await writeFile(source, plaintext);

    const imported = await importFile(first.root, keys, source);
    const file = first.documents.addFile({
      id: imported.id,
      filename: 'passport.jpg',
      mime: 'image/jpeg',
      sha256: imported.sha256,
      encryptedPath: imported.encryptedPath,
    });
    first.documents.addDocument({ title: 'Passport', fileId: file.id });

    const pushed = await first.engine.sync();
    expect(pushed.uploadedFiles).toBe(1);

    const pulled = await second.engine.sync();
    expect(pulled.downloadedFiles).toBe(1);

    // The second device never saw the original and holds no copy of the path
    // the first one used; it decrypts from the record alone.
    const arrived = second.documents.getFile(file.id);
    expect(arrived?.encryptedPath).toBe(imported.encryptedPath);

    const recovered = await decryptFile(second.root, keys, arrived!);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it('leaves nothing readable in the folder', async () => {
    const folder = await directory();
    const created = await createVault(webCryptoProvider, { passphrase: 'correct horse battery' });
    const keys = await deriveVaultKeys(webCryptoProvider, created.dataKey);
    const device = await newDevice('dev_first', keys, folder);

    const plaintext = Buffer.from('PASSPORT NUMBER K1234567', 'utf8');
    const source = join(device.root, 'scan.jpg');
    await writeFile(source, plaintext);

    const imported = await importFile(device.root, keys, source);
    device.documents.addFile({ id: imported.id, encryptedPath: imported.encryptedPath });
    await device.engine.sync();

    const inFolder = await readFile(join(folder, fileObjectKey(imported.id)));
    expect(inFolder.includes('PASSPORT')).toBe(false);
    expect(inFolder.length).toBeGreaterThan(plaintext.length);
  });

  it('takes the bytes off both devices when the document is deleted', async () => {
    const folder = await directory();
    const created = await createVault(webCryptoProvider, { passphrase: 'correct horse battery' });
    const keys = await deriveVaultKeys(webCryptoProvider, created.dataKey);

    const first = await newDevice('dev_first', keys, folder);
    const second = await newDevice('dev_second', keys, folder);

    const source = join(first.root, 'scan.jpg');
    await writeFile(source, new Uint8Array([1, 2, 3, 4]));
    const imported = await importFile(first.root, keys, source);
    const file = first.documents.addFile({
      id: imported.id,
      encryptedPath: imported.encryptedPath,
    });
    const document = first.documents.addDocument({ title: 'Passport', fileId: file.id });

    await first.engine.sync();
    await second.engine.sync();
    await expect(readFile(join(second.root, imported.encryptedPath))).resolves.toBeDefined();

    first.documents.deleteDocument(document.id);
    await first.engine.sync();
    await second.engine.sync();

    // Gone from the folder, from the device that deleted it, and from the one
    // that only learned about the deletion.
    await expect(readFile(join(folder, fileObjectKey(imported.id)))).rejects.toThrow();
    await expect(readFile(join(first.root, imported.encryptedPath))).rejects.toThrow();
    await expect(readFile(join(second.root, imported.encryptedPath))).rejects.toThrow();
  });
});
