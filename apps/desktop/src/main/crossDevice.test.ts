/**
 * Can the desktop read a vault the Android app actually wrote?
 *
 * Everything else about sync is tested against segments this same code produced,
 * which cannot catch a disagreement between the two platforms — the one failure
 * that would make sync useless while every test still passed.
 *
 * So this reads a folder produced by the real Android build: its SAF folder
 * backend, its native AES-GCM, its PBKDF2, its portable HKDF. If the desktop can
 * unwrap that keyfile and replay those segments, the two genuinely interoperate.
 *
 * The fixture in test-fixtures/android-vault was captured from a real emulator
 * run, and is committed so this keeps being checked. It is a throwaway vault
 * holding one 4.500 TND expense; its passphrase is in this file, deliberately,
 * because there is nothing in it to protect.
 *
 * To recapture after a format change:
 *
 *   adb pull /sdcard/Documents/keyfile.json  <fixture>/keyfile.json
 *   adb pull /sdcard/Documents/oplog         <fixture>/oplog
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ExpenseRepository,
  SyncEngine,
  VaultStore,
  deriveVaultKeys,
  fetchKeyfileFrom,
  parseKeyfile,
  toDecimalString,
  toSqlCipherKey,
  unlockVault,
  webCryptoProvider,
} from '@vaultp/core';

import { FolderBackend } from './folderBackend.js';
import { openDesktopDatabase } from './db.js';

const FIXTURE =
  process.env.VAULTP_ANDROID_FIXTURE ??
  join(import.meta.dirname, '..', '..', 'test-fixtures', 'android-vault');

/** The throwaway passphrase used on the emulator. Not a real vault. */
const PASSPHRASE = 'emulator-test-vault-passphrase';

const available = existsSync(join(FIXTURE, 'keyfile.json'));
const workspaces: string[] = [];

afterAll(async () => {
  for (const workspace of workspaces) {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe.skipIf(!available)('a vault written by the Android app', () => {
  it('unwraps a keyfile the phone wrapped', async () => {
    const serialized = await fetchKeyfileFrom(new FolderBackend(FIXTURE));
    expect(serialized).toBeDefined();

    // The phone derived this key with a native PBKDF2; the desktop unwraps it
    // with WebCrypto's. Different implementations, one answer, or nothing here
    // works at all.
    const opened = await unlockVault(
      webCryptoProvider,
      parseKeyfile(serialized!),
      PASSPHRASE,
    );

    expect(opened.slot).toBe('primary');
    expect(opened.dataKey).toHaveLength(32);
  });

  it('refuses the wrong passphrase against a real phone keyfile', async () => {
    const serialized = await fetchKeyfileFrom(new FolderBackend(FIXTURE));
    await expect(
      unlockVault(webCryptoProvider, parseKeyfile(serialized!), 'not the passphrase'),
    ).rejects.toThrow();
  });

  it('replays the segments the phone wrote and finds its expense', async () => {
    const serialized = await fetchKeyfileFrom(new FolderBackend(FIXTURE));
    const opened = await unlockVault(
      webCryptoProvider,
      parseKeyfile(serialized!),
      PASSPHRASE,
    );
    const keys = await deriveVaultKeys(webCryptoProvider, opened.dataKey);

    const workspace = await mkdtemp(join(tmpdir(), 'vaultp-cross-'));
    workspaces.push(workspace);

    const db = openDesktopDatabase({
      path: join(workspace, 'joined.db'),
      encryptionKey: toSqlCipherKey(keys.database),
    });
    const store = VaultStore.open({ db, device: 'dev_desktop_test' });

    const engine = new SyncEngine({
      store,
      backend: new FolderBackend(FIXTURE),
      provider: webCryptoProvider,
      oplogKey: keys.oplog,
    });

    const report = await engine.pull();

    try {
      // The emulator logged one expense of 4.500 TND under Food, and the seeded
      // categories arrived with it.
      expect(report.appliedEvents).toBeGreaterThan(0);

      const expenses = new ExpenseRepository(store).listExpenses();
      expect(expenses).toHaveLength(1);
      expect(toDecimalString(expenses[0]!.amount)).toBe('4.500');
      expect(expenses[0]!.amount.currency).toBe('TND');
      expect(expenses[0]!.categoryId).toBe('cat_food');
    } finally {
      db.close();
    }
  });
});
