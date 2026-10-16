/**
 * Updating the app itself.
 *
 * New versions are published as GitHub releases; this checks there, downloads
 * in the background, and installs when the app next closes — or straight away
 * if the person asks. Nothing about the vault goes anywhere: the request is for
 * a version manifest, and what GitHub learns is that some computer at this
 * address runs VaultP. That is still more than nothing for an app whose promise
 * is that it talks to nobody, so it is a setting, stated plainly, and off means
 * off.
 *
 * The setting lives beside the vault rather than in it, because the check runs
 * whether or not the vault is unlocked.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import electronUpdater from 'electron-updater';

import type { UpdateStatusDto } from '../shared/api.js';

const { autoUpdater } = electronUpdater;

const SETTINGS_FILE = 'updates.json';
/** Long enough that startup is never competing with it. */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatusDto = {
  enabled: true,
  state: 'idle',
  currentVersion: app.getVersion(),
  nextVersion: null,
  detail: null,
  checkedAt: null,
};
let timer: ReturnType<typeof setInterval> | undefined;

/** Why this build cannot update itself, or null if it can. */
function unsupportedReason(): string | null {
  // electron-builder's portable target unpacks to a temp folder each run and
  // sets this; there is no installation to replace.
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return 'The portable version does not update itself. Download the new one from the website when you want it.';
  }
  if (!app.isPackaged) return 'Development run — updates apply to installed copies only.';
  return null;
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE);
}

async function readEnabled(): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8')) as { check?: unknown };
    return parsed.check !== false;
  } catch {
    return true;
  }
}

function publish(next: Partial<UpdateStatusDto>): UpdateStatusDto {
  status = { ...status, ...next };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:changed', status);
  }
  return status;
}

function schedule(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!status.enabled || status.state === 'unsupported') return;
  timer = setInterval(() => void checkNow(), CHECK_EVERY_MS);
  timer.unref();
}

export function updateStatus(): UpdateStatusDto {
  return status;
}

export async function checkNow(): Promise<UpdateStatusDto> {
  if (status.state === 'unsupported') return status;
  // A finished download is not thrown away by checking again.
  if (status.state === 'ready' || status.state === 'checking' || status.state === 'downloading') {
    return status;
  }
  publish({ state: 'checking', detail: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch (caught: unknown) {
    publish({
      state: 'error',
      detail: caught instanceof Error ? friendly(caught.message) : 'The update check failed.',
      checkedAt: new Date().toISOString(),
    });
  }
  return status;
}

/** The updater's errors are written for developers; keep the gist. */
function friendly(message: string): string {
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|getaddrinfo/i.test(message)) {
    return 'Could not reach the update server. It will try again later.';
  }
  if (/404|latest\.yml/i.test(message)) return 'No published release to compare against yet.';
  return message.split('\n')[0] ?? message;
}

export async function setChecks(enabled: boolean): Promise<UpdateStatusDto> {
  await writeFile(settingsPath(), JSON.stringify({ check: enabled }), 'utf8');
  publish({ enabled });
  schedule();
  if (enabled) void checkNow();
  return status;
}

export function installNow(): void {
  if (status.state !== 'ready') return;
  // isSilent: false shows the installer's progress; isForceRunAfter reopens the
  // app afterwards, which is what someone pressing "Restart" expects.
  autoUpdater.quitAndInstall(false, true);
}

export async function startUpdates(): Promise<void> {
  const enabled = await readEnabled();
  const reason = unsupportedReason();
  publish({ enabled, state: reason ? 'unsupported' : 'idle', detail: reason });
  if (reason) return;

  autoUpdater.autoDownload = true;
  // Installed on the way out if the person never presses Restart, so an update
  // never interrupts anything.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    publish({ state: 'downloading', nextVersion: info.version, checkedAt: new Date().toISOString() });
  });
  autoUpdater.on('update-not-available', () => {
    publish({ state: 'current', nextVersion: null, checkedAt: new Date().toISOString() });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publish({ state: 'ready', nextVersion: info.version });
  });
  autoUpdater.on('error', (error) => {
    // A failure mid-download keeps no partial state worth showing.
    publish({ state: 'error', detail: friendly(error.message), checkedAt: new Date().toISOString() });
  });

  schedule();
  if (enabled) setTimeout(() => void checkNow(), FIRST_CHECK_DELAY_MS).unref();
}
