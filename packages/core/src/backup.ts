/**
 * Getting everything out, and putting it back.
 *
 * The export is the event log, not the tables. Replaying it rebuilds every row
 * exactly, including history and deletions, so a restore is not an approximation
 * of the vault — it is the vault. Exporting materialized rows instead would lose
 * the audit trail and quietly discard anything a newer version had added.
 *
 * The format is plain JSON with a version on it. Someone reading this file in ten
 * years, with none of this software, should still be able to see what was in it.
 * That is the point of an export: it is what you have left when the app is gone.
 */

import type { VaultStore } from './db/store.js';
import { SCHEMA_VERSION, type VaultEvent, assertValidEvent } from './oplog/event.js';

export const BACKUP_VERSION = 1;

export interface VaultBackup {
  readonly format: 'vaultp-backup';
  readonly version: number;
  readonly exportedAt: string;
  readonly device: string;
  readonly schemaVersion: number;
  readonly eventCount: number;
  readonly events: readonly VaultEvent[];
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/**
 * Everything, in order.
 *
 * Deliberately not encrypted here. The caller decides where it goes and what
 * protects it — a file the user saves themselves is a different decision from a
 * segment uploaded to cloud storage, and this layer should not assume which.
 * Whatever writes it must treat it as the most sensitive artefact the app can
 * produce: it is the whole vault in the clear.
 */
export function exportBackup(store: VaultStore): VaultBackup {
  const events = store.allEvents();

  return {
    format: 'vaultp-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    device: store.device,
    schemaVersion: SCHEMA_VERSION,
    eventCount: events.length,
    events,
  };
}

export function serializeBackup(backup: VaultBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(text: string): VaultBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError('That file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupFormatError('That file is not a VaultP backup.');
  }

  const backup = parsed as Partial<VaultBackup>;
  if (backup.format !== 'vaultp-backup') {
    throw new BackupFormatError('That file is not a VaultP backup.');
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new BackupFormatError(
      `This backup was written by a newer version of the app (format ${String(
        backup.version,
      )}). Update before restoring it, or events could be dropped.`,
    );
  }
  if (!Array.isArray(backup.events)) {
    throw new BackupFormatError('This backup contains no events.');
  }

  for (const event of backup.events) assertValidEvent(event);

  return backup as VaultBackup;
}

export interface RestoreResult {
  /** Events in the file. */
  readonly total: number;
  /** Events this vault did not already have. */
  readonly applied: number;
}

/**
 * Merge a backup into this vault.
 *
 * A merge rather than a replace, and safe to run twice: events are identified and
 * ordered by their own timestamps, so restoring into an empty vault reproduces it
 * exactly, while restoring into a vault that has moved on since simply fills in
 * what is missing. Nothing already here is lost.
 */
export function restoreBackup(store: VaultStore, backup: VaultBackup): RestoreResult {
  return {
    total: backup.events.length,
    applied: store.ingest(backup.events),
  };
}

/** A filename that sorts chronologically and says what it is. */
export function backupFilename(exportedAt: string = new Date().toISOString()): string {
  return `vaultp-backup-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
}
