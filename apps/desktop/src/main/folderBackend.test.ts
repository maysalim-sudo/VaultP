import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ExpenseRepository,
  ObjectNotFoundError,
  SyncEngine,
  VaultStore,
  parseAmount,
  toDecimalString,
  webCryptoProvider,
} from '@vaultp/core';
import Database from 'better-sqlite3-multiple-ciphers';

import { FolderBackend } from './folderBackend.js';
import { openDesktopDatabase } from './db.js';

const tnd = (value: string) => parseAmount(value, 'TND');

let folder: string;
let workspace: string;
/** Windows will not delete an open database file, so every one is closed first. */
let opened: Array<{ close(): void }>;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vaultp-'));
  folder = join(workspace, 'sync');
  opened = [];
});

afterEach(async () => {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      // Already closed by the test itself.
    }
  }
  await rm(workspace, { recursive: true, force: true });
});

/** One shared key, as two devices unlocked with the same passphrase would have. */
const OPLOG_KEY = webCryptoProvider.randomBytes(32);

function newDevice(name: string) {
  // A real encrypted database file, so this exercises the desktop driver too
  // rather than testing sync against a different storage engine than it ships on.
  const db = openDesktopDatabase({
    path: join(workspace, `${name}.db`),
    encryptionKey: `x'${'ab'.repeat(32)}'`,
  });
  opened.push(db);
  const store = VaultStore.open({ db, device: name });
  const engine = new SyncEngine({
    store,
    backend: new FolderBackend(folder),
    provider: webCryptoProvider,
    oplogKey: OPLOG_KEY,
  });
  return { store, engine, expenses: new ExpenseRepository(store) };
}

describe('folder backend', () => {
  it('treats a folder that does not exist as empty', async () => {
    const backend = new FolderBackend(join(workspace, 'nothing-here'));
    expect(await backend.list('')).toEqual([]);
  });

  it('round-trips an object through nested keys', async () => {
    const backend = new FolderBackend(folder);
    const payload = new Uint8Array([1, 2, 3, 250]);

    await backend.put('oplog/dev_a/000001.seg.enc', payload);

    expect(await backend.get('oplog/dev_a/000001.seg.enc')).toEqual(payload);
    expect((await backend.list('oplog/')).map((o) => o.key)).toEqual([
      'oplog/dev_a/000001.seg.enc',
    ]);
  });

  it('reports a missing object rather than returning nothing', async () => {
    const backend = new FolderBackend(folder);
    await expect(backend.get('oplog/dev_a/000001.seg.enc')).rejects.toThrow(
      ObjectNotFoundError,
    );
  });

  it('leaves no partial file behind after a write', async () => {
    const backend = new FolderBackend(folder);
    await backend.put('oplog/dev_a/000001.seg.enc', new Uint8Array([9]));

    // A sync client watching this folder copies whatever it sees; a .tmp left
    // lying around would eventually be handed to the decryptor as a segment.
    const entries = await readdir(join(folder, 'oplog', 'dev_a'));
    expect(entries).toEqual(['000001.seg.enc']);
  });

  it('ignores half-written and hidden files when listing', async () => {
    const backend = new FolderBackend(folder);
    await backend.put('oplog/dev_a/000001.seg.enc', new Uint8Array([1]));

    // As a sync client mid-copy leaves things.
    await writeFile(join(folder, 'oplog', 'dev_a', '000002.seg.enc.tmp'), 'partial');
    await writeFile(join(folder, 'oplog', 'dev_a', '.syncthing.tmp'), 'partial');

    expect((await backend.list('oplog/')).map((o) => o.key)).toEqual([
      'oplog/dev_a/000001.seg.enc',
    ]);
  });

  it('deletes without complaining about what is not there', async () => {
    const backend = new FolderBackend(folder);
    await expect(backend.delete('oplog/dev_a/nope.enc')).resolves.toBeUndefined();
  });
});

describe('two devices over a shared folder', () => {
  it('carries an expense from one machine to the other', async () => {
    const phone = newDevice('dev_phone');
    const desktop = newDevice('dev_desktop');

    phone.expenses.addExpense({
      id: 'e1',
      occurredOn: '2026-09-07',
      amount: tnd('4.500'),
      merchant: 'Cafe',
    });

    await phone.engine.sync();
    await desktop.engine.sync();

    expect(toDecimalString(desktop.expenses.getExpense('e1')!.amount)).toBe('4.500');
    expect(desktop.expenses.getExpense('e1')?.merchant).toBe('Cafe');
  });

  it('converges when both edited the same row offline', async () => {
    const phone = newDevice('dev_phone');
    const desktop = newDevice('dev_desktop');

    phone.expenses.addExpense({ id: 'e1', occurredOn: '2026-09-07', amount: tnd('4.500') });
    await phone.engine.sync();
    await desktop.engine.sync();

    // Different fields of one expense, neither device aware of the other.
    phone.expenses.updateExpense('e1', { amount: tnd('5.000') });
    desktop.expenses.updateExpense('e1', { merchant: 'Cafe des Nattes' });

    await phone.engine.sync();
    await desktop.engine.sync();
    await phone.engine.sync();

    for (const device of [phone, desktop]) {
      const expense = device.expenses.getExpense('e1')!;
      expect(toDecimalString(expense.amount)).toBe('5.000');
      expect(expense.merchant).toBe('Cafe des Nattes');
    }
  });

  it('writes only ciphertext into the folder', async () => {
    const phone = newDevice('dev_phone');
    phone.expenses.addExpense({
      occurredOn: '2026-09-07',
      amount: tnd('4.500'),
      merchant: 'Carrefour',
    });
    await phone.engine.sync();

    const backend = new FolderBackend(folder);
    const [segment] = await backend.list('oplog/');
    const bytes = await backend.get(segment!.key);
    const text = Buffer.from(bytes).toString('latin1');

    // Whatever keeps this folder in sync — Drive, Syncthing, a shared drive —
    // sees this and nothing more.
    for (const secret of ['Carrefour', 'expense', '4500', 'TND']) {
      expect(text).not.toContain(secret);
    }
  });

  it('does nothing on a second sync with no changes', async () => {
    const phone = newDevice('dev_phone');
    phone.expenses.addExpense({ occurredOn: '2026-09-07', amount: tnd('4.500') });

    await phone.engine.sync();
    const second = await phone.engine.sync();

    expect(second.pushedSegments).toBe(0);
    expect(second.pulledSegments).toBe(0);
  });

  it('rebuilds a vault from the folder alone', async () => {
    const phone = newDevice('dev_phone');
    phone.expenses.addCategory({ id: 'food', name: 'Food' });
    phone.expenses.addExpense({
      id: 'e1',
      occurredOn: '2026-09-07',
      amount: tnd('12.000'),
      categoryId: 'food',
    });
    await phone.engine.sync();

    // A replacement machine: nothing local, same passphrase, same folder.
    const replacement = newDevice('dev_replacement');
    await replacement.engine.sync();

    expect(replacement.expenses.getCategory('food')?.name).toBe('Food');
    expect(toDecimalString(replacement.expenses.getExpense('e1')!.amount)).toBe('12.000');
  });
});

describe('the encrypted database', () => {
  it('is unreadable without the key', async () => {
    const path = join(workspace, 'locked.db');
    const db = openDesktopDatabase({ path, encryptionKey: `x'${'cd'.repeat(32)}'` });
    db.exec('CREATE TABLE secret (value TEXT)');
    db.run('INSERT INTO secret VALUES (?)', ['passport number 12345678']);
    db.close();

    // Opening it as an ordinary SQLite file must fail, not return rows.
    const plain = new Database(path);
    opened.push(plain);
    expect(() => plain.prepare('SELECT * FROM secret').all()).toThrow();
  });
});
