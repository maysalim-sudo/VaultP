/**
 * The other direction: does the phone read what the desktop wrote?
 *
 * Runs only when VAULTP_SYNC_FOLDER points at a real folder shared with a
 * device, because the assertion happens on that device rather than here. It
 * writes one recognisable expense and pushes it; the phone then syncs and should
 * show it.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ExpenseRepository,
  SyncEngine,
  VaultStore,
  deriveVaultKeys,
  fetchKeyfileFrom,
  parseAmount,
  parseKeyfile,
  toSqlCipherKey,
  unlockVault,
  webCryptoProvider,
} from '@vaultp/core';

import { FolderBackend } from './folderBackend.js';
import { openDesktopDatabase } from './db.js';

const folder = process.env.VAULTP_SYNC_FOLDER;
const passphrase = process.env.VAULTP_SYNC_PASSPHRASE;

describe.skipIf(!folder || !passphrase)('writing for a real device to read', () => {
  it('pushes an expense the phone can pick up', async () => {
    const backend = new FolderBackend(folder!);

    const serialized = await fetchKeyfileFrom(backend);
    expect(serialized, 'sync from the phone first so a keyfile exists').toBeDefined();

    const opened = await unlockVault(webCryptoProvider, parseKeyfile(serialized!), passphrase!);
    const keys = await deriveVaultKeys(webCryptoProvider, opened.dataKey);

    const workspace = await mkdtemp(join(tmpdir(), 'vaultp-desktop-'));
    const db = openDesktopDatabase({
      path: join(workspace, 'desktop.db'),
      encryptionKey: toSqlCipherKey(keys.database),
    });
    const store = VaultStore.open({ db, device: 'dev_desktop_pc' });

    const engine = new SyncEngine({
      store,
      backend,
      provider: webCryptoProvider,
      oplogKey: keys.oplog,
    });

    try {
      // Pull first, so this device has the categories the phone created.
      await engine.pull();

      new ExpenseRepository(store).addExpense({
        id: 'desktop-written-expense',
        occurredOn: '2026-09-07',
        amount: parseAmount('123.750', 'TND'),
        merchant: 'Written on the desktop',
        categoryId: 'cat_bills',
      });

      const report = await engine.push();
      expect(report.pushedEvents).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
