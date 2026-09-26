/**
 * The Electron main process.
 *
 * The vault lives here, in Node, not in the window. The renderer gets a narrow
 * set of named operations over IPC and never touches the database, the keys or
 * the filesystem — so a mistake in the UI cannot reach the data, and neither can
 * anything that ends up running inside a web page.
 */

import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { join } from 'node:path';

import { BASE_CURRENCY, darkColors, lightColors } from '@vaultp/core';

import { shutdownOcr } from './ocr.js';

import { registerDebtHandlers } from './handlers/debts.js';
import { registerDocumentHandlers } from './handlers/documents.js';
import { registerExpenseHandlers } from './handlers/expenses.js';
import { registerNoteHandlers } from './handlers/notes.js';
import { registerOverviewHandlers } from './handlers/overview.js';
import { registerRuleHandlers } from './handlers/rules.js';
import { registerVaultDataHandlers } from './handlers/vaultData.js';
import {
  adoptKeyfile,
  createDesktopVault,
  driveBackendFor,
  hasVault,
  joinFromFolder,
  syncWith,
  syncWithFolder,
  unlockDesktopVault,
  type DesktopVault,
} from './vault.js';
import { connect, connection, forget } from './driveAuth.js';
import type { SyncTarget } from '../shared/api.js';

let vault: DesktopVault | undefined;
let syncFolder: string | undefined;
/** Which storage a sync goes to. Remembered for the session, not the vault. */
let syncTarget: SyncTarget = 'folder';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    // Painted before the page loads, so it must match the theme the page is
    // about to draw or the window flashes the wrong ground on open.
    backgroundColor: nativeTheme.shouldUseDarkColors ? darkColors.bg : lightColors.bg,
    title: 'VaultP',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.cjs'),
      // The renderer is a web page and is treated as one: no Node, no direct
      // access to anything in this process except the listed channels.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// The recognition worker is a live WebAssembly process. Left running it keeps
// the app alive after the window is gone.
app.on('before-quit', () => {
  void shutdownOcr();
});

function requireVault(): DesktopVault {
  if (!vault) throw new Error('The vault is locked.');
  return vault;
}

ipcMain.handle('vault:status', async () => ({
  exists: await hasVault(),
  open: vault !== undefined,
  syncFolder,
  baseCurrency: BASE_CURRENCY,
  syncTarget,
}));

ipcMain.handle('vault:create', async (_event, passphrase: string) => {
  vault = await createDesktopVault(passphrase);
  return { slot: vault.slot, deviceId: vault.deviceId };
});

ipcMain.handle('vault:unlock', async (_event, passphrase: string) => {
  vault = await unlockDesktopVault(passphrase);
  return { slot: vault.slot, deviceId: vault.deviceId };
});

/**
 * Adopt the phone's keyfile.
 *
 * Two devices must share one data key, or they encrypt their oplog segments
 * differently and neither can read the other's. Creating a separate vault here
 * and hoping sync merges them would silently produce two vaults that never
 * converge.
 */
ipcMain.handle('vault:adopt', async (_event, passphrase: string) => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose the keyfile from your phone backup',
    filters: [{ name: 'Keyfile', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths[0]) return undefined;

  const { readFile } = await import('node:fs/promises');
  vault = await adoptKeyfile(await readFile(picked.filePaths[0], 'utf8'), passphrase);
  return { slot: vault.slot, deviceId: vault.deviceId };
});

/**
 * Join the phone's vault through the sync folder.
 *
 * The keyfile the phone published is fetched and unwrapped with the passphrase,
 * so both devices end up holding the same data key. Creating a vault here
 * instead would make a second one that never converges with the first.
 */
ipcMain.handle('vault:joinFolder', async (_event, passphrase: string) => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose the folder your phone syncs to',
    properties: ['openDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return undefined;

  const folder = picked.filePaths[0];
  const joined = await joinFromFolder(folder, passphrase);
  if (!joined) {
    throw new Error(
      'No vault found in that folder. Sync once from the phone first, so it can leave its key file there.',
    );
  }

  vault = joined;
  syncFolder = folder;
  await syncWithFolder(vault, folder);
  return { slot: vault.slot, deviceId: vault.deviceId };
});

ipcMain.handle('vault:chooseSyncFolder', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose a folder both devices can see',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return syncFolder;

  syncFolder = picked.filePaths[0];
  return syncFolder;
});

ipcMain.handle('vault:sync', async () => {
  const current = requireVault();

  if (syncTarget === 'drive') {
    const backend = await driveBackendFor(current);
    if (!backend) throw new Error('No Google account is connected to this vault.');
    return syncWith(current, backend);
  }

  if (!syncFolder) throw new Error('Choose a sync folder first.');
  return syncWithFolder(current, syncFolder);
});

ipcMain.handle('vault:setSyncTarget', (_event, target: SyncTarget) => {
  syncTarget = target;
});

ipcMain.handle('drive:status', () => {
  const current = requireVault();
  return connection(current.store, current.keys);
});

ipcMain.handle(
  'drive:connect',
  async (_event, input: { clientId: string; clientSecret: string; folderName: string }) => {
    const current = requireVault();
    const result = await connect(current.store, current.keys, input);
    // Connecting is a statement of intent: the next sync should go there.
    syncTarget = 'drive';
    return result;
  },
);

ipcMain.handle('drive:disconnect', () => {
  const current = requireVault();
  forget(current.store);
  syncTarget = 'folder';
});

registerOverviewHandlers(requireVault);
registerExpenseHandlers(requireVault);
registerRuleHandlers(requireVault);
registerNoteHandlers(requireVault);
registerDocumentHandlers(requireVault);
registerDebtHandlers(requireVault);
registerVaultDataHandlers(requireVault);
