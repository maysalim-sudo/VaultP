/**
 * When the vault was last backed up.
 *
 * An export is only worth something if it is recent, and the one question the
 * backup screen should answer at a glance is "am I covered?". So each export is
 * noted — when, and how many entries the vault held — as an ordinary setting.
 * It travels with sync like any other: a backup taken on the desktop counts on
 * the phone too, since it holds the same vault.
 *
 * The note is written after the export, so it is never inside the file it
 * describes; the next backup carries it.
 */

import type { VaultStore } from './db/store.js';
import { readSetting, writeSetting } from './settings.js';
import { type IsoDate, addDays, compareDates } from './time/date.js';

export const BACKUP_HISTORY_KEY = 'backup_history';

/** Enough history to draw a few weeks of coverage; older entries are dropped. */
const KEEP = 24;

export interface BackupRecord {
  /** ISO timestamp of the export. */
  readonly at: string;
  /** How many events the vault held when it was exported. */
  readonly events: number;
}

function isHistory(value: unknown): value is BackupRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as BackupRecord).at === 'string' &&
        typeof (entry as BackupRecord).events === 'number',
    )
  );
}

/** Newest first. Empty when no backup has ever been made. */
export function loadBackupHistory(store: VaultStore): BackupRecord[] {
  return [...readSetting<BackupRecord[]>(store, BACKUP_HISTORY_KEY, [], isHistory)].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
}

export function recordBackup(store: VaultStore, events: number, at: string = new Date().toISOString()): void {
  const history = [{ at, events }, ...loadBackupHistory(store)].slice(0, KEEP);
  writeSetting(store, BACKUP_HISTORY_KEY, history);
}

/**
 * Which of the last `weeks` seven-day windows had a backup, oldest first, the
 * last window ending today. Drawn as a short row of bars: a gap is a week the
 * vault went unprotected.
 */
export function backupCoverage(history: readonly BackupRecord[], today: IsoDate, weeks = 4): boolean[] {
  const days = history.map((record) => record.at.slice(0, 10) as IsoDate);
  return Array.from({ length: weeks }, (_, index) => {
    const end = addDays(today, -7 * (weeks - 1 - index));
    const start = addDays(end, -6);
    return days.some((day) => compareDates(day, start) >= 0 && compareDates(day, end) <= 0);
  });
}
