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
  openFromHandoff,
  setVaultAside,
  syncWith,
  syncWithFolder,
  syncWithHub,
  unlockDesktopVault,
  type DesktopVault,
} from './vault.js';
import {
  beginHandoff,
  cancelHandoff,
  ensurePairing,
  forgetPairing,
  hubDirectory,
  isPaired,
  pairingStatus,
  startPairing,
} from './pairing.js';
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
  // With a phone paired, that is where sync goes — and whatever the phone left
  // while this window was locked is pulled in straight away.
  if (isPaired()) {
    syncTarget = 'pair';
    scheduleHubSync();
  }
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

  if (syncTarget === 'pair') {
    if (!isPaired()) throw new Error('No phone is paired with this computer.');
    return syncWithHub(current, hubDirectory(dataRoot()));
  }

  if (!syncFolder) throw new Error('Choose a sync folder first.');
  return syncWithFolder(current, syncFolder);
});

ipcMain.handle('vault:setSyncTarget', (_event, target: SyncTarget) => {
  syncTarget = target;
});

// ------------------------------------------------------------------ pairing
//
// A paired phone syncs straight to this computer over the local network. The
// hub it talks to is a folder here; this vault syncs with that folder whenever
// the phone delivers something, on a slow timer, and on request — so nobody has
// to press Sync on both devices.

const dataRoot = () => app.getPath('userData');
let hubSyncTimer: ReturnType<typeof setTimeout> | undefined;
let hubSyncRunning = false;

function notifyChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('vault:changed');
}

async function syncHubNow(): Promise<void> {
  if (!vault || !isPaired() || hubSyncRunning) return;
  hubSyncRunning = true;
  try {
    const report = await syncWithHub(vault, hubDirectory(dataRoot()));
    if (report.appliedEvents > 0 || report.downloadedFiles > 0) notifyChanged();
  } catch {
    // A failed background sync is retried by the next one; the manual Sync
    // button is where an error is worth showing.
  } finally {
    hubSyncRunning = false;
  }
}

/** Soon, but not once per object while the phone is mid-upload. */
function scheduleHubSync(): void {
  if (hubSyncTimer) clearTimeout(hubSyncTimer);
  hubSyncTimer = setTimeout(() => void syncHubNow(), 1500);
}

// This computer's own changes reach the hub without being asked.
setInterval(() => void syncHubNow(), 20_000).unref();

app.whenReady().then(() => {
  // Serve the hub from launch if a phone is paired, locked window or not.
  void startPairing(dataRoot(), scheduleHubSync).catch(() => undefined);
});

ipcMain.handle('pairing:status', () => pairingStatus(dataRoot()));

ipcMain.handle('pairing:start', async () => {
  await ensurePairing(dataRoot(), scheduleHubSync);
  if (vault) {
    // Pairing is a statement of intent: sync goes to the phone from now on.
    syncTarget = 'pair';
    await syncWithHub(vault, hubDirectory(dataRoot()));
  }
  return pairingStatus(dataRoot());
});

ipcMain.handle('pairing:forget', async () => {
  await forgetPairing(dataRoot());
  if (syncTarget === 'pair') syncTarget = 'folder';
});

/**
 * Unlock with the phone.
 *
 * Shows a one-time code; the phone scans it, asks for a fingerprint, and hands
 * the vault key over sealed to a key only this process holds. No passphrase is
 * typed anywhere. Works on a computer that has the vault, and on one that has
 * nothing yet — which then fills itself by sync.
 */
ipcMain.handle('handoff:start', async () => {
  await ensurePairing(dataRoot(), scheduleHubSync);
  beginHandoff(async (handoff) => {
    try {
      vault = await openFromHandoff(handoff);
    } catch (caught: unknown) {
      return caught instanceof Error ? caught.message : 'The computer could not open the vault with that key.';
    }
    syncTarget = 'pair';
    scheduleHubSync();
    notifyChanged();
    return null;
  });
  return pairingStatus(dataRoot());
});

ipcMain.handle('handoff:cancel', () => {
  cancelHandoff();
});

/**
 * Start over on this computer, when its passphrase is gone for good.
 *
 * Only from the locked window: an open vault has its database held open, and
 * someone who can open it does not need to start over.
 */
ipcMain.handle('vault:setAside', async () => {
  if (vault) throw new Error('The vault is open. This is for when it cannot be opened.');
  cancelHandoff();
  // The pairing belonged to the old vault's hub; a fresh one is made on demand.
  await forgetPairing(dataRoot());
  syncFolder = undefined;
  syncTarget = 'folder';
  return setVaultAside();
});

/**
 * Join the vault the phone left in the hub.
 *
 * The same join as from a sync folder — the keyfile is fetched and unwrapped
 * with the passphrase — only the folder is the hub, filled by the phone a moment
 * ago over the network rather than by Syncthing.
 */
ipcMain.handle('vault:joinPair', async (_event, passphrase: string) => {
  const hub = hubDirectory(dataRoot());
  const joined = await joinFromFolder(hub, passphrase);
  if (!joined) {
    throw new Error('The phone has not sent its vault yet. Scan the code with the phone and wait for it to finish.');
  }
  vault = joined;
  syncTarget = 'pair';
  await syncWithHub(vault, hub);
  return { slot: vault.slot, deviceId: vault.deviceId };
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
