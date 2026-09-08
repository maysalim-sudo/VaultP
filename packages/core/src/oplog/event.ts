/**
 * The event log. Every mutation in the vault is an immutable event; the SQLite
 * tables are a cache of replaying them.
 *
 * This single mechanism provides the audit trail, versioned backup, undo, and
 * device sync. Nothing is ever updated in place, so a bad merge cannot destroy
 * data — it can only append something that is later superseded.
 */

import type { Hlc } from '../clock/hlc.js';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Bumped when the shape of stored fields changes, so old events stay replayable. */
export const SCHEMA_VERSION = 1;

export type EntityName =
  | 'category'
  | 'expense'
  | 'recurring_rule'
  | 'person'
  | 'debt_entry'
  | 'document'
  | 'note'
  | 'tag'
  | 'tagging'
  | 'file'
  | 'attachment'
  | 'link'
  | 'setting';

export type Operation = 'put' | 'delete';

export interface VaultEvent {
  /** UUIDv7. Also the dedupe key: replaying the same event twice is a no-op. */
  readonly id: string;
  readonly hlc: string;
  readonly device: string;
  readonly entity: EntityName;
  readonly entityId: string;
  readonly op: Operation;
  /** Only the fields that changed. Absent keys are untouched, not cleared. */
  readonly fields: Readonly<Record<string, Json>>;
  readonly schemaVersion: number;
}

/** Soft-delete marker. Deletion is an ordinary field write, so it merges by the
 *  same last-write-wins rule as everything else and can be undone by a later
 *  write that sets it back to null. */
export const DELETED_AT = 'deleted_at';

export interface NewEventInput {
  readonly entity: EntityName;
  readonly entityId: string;
  readonly op: Operation;
  readonly fields?: Readonly<Record<string, Json>>;
  readonly id: string;
  readonly hlc: Hlc;
  readonly encodedHlc: string;
}

export function createEvent(input: NewEventInput): VaultEvent {
  return {
    id: input.id,
    hlc: input.encodedHlc,
    device: input.hlc.device,
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    fields: input.op === 'delete' ? {} : (input.fields ?? {}),
    schemaVersion: SCHEMA_VERSION,
  };
}

export class UnsupportedSchemaError extends Error {
  constructor(version: number) {
    super(
      `Event uses schema version ${version}, newer than this build supports ` +
        `(${SCHEMA_VERSION}). Update the app before syncing, or the event would ` +
        `be applied with fields this version does not understand.`,
    );
    this.name = 'UnsupportedSchemaError';
  }
}

/** Validate an event arriving from storage or another device. */
export function assertValidEvent(value: unknown): asserts value is VaultEvent {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Event is not an object.');
  }
  const event = value as Partial<VaultEvent>;
  for (const key of ['id', 'hlc', 'device', 'entity', 'entityId', 'op'] as const) {
    if (typeof event[key] !== 'string' || event[key] === '') {
      throw new Error(`Event is missing required field "${key}".`);
    }
  }
  if (event.op !== 'put' && event.op !== 'delete') {
    throw new Error(`Unknown operation "${String(event.op)}".`);
  }
  if (typeof event.fields !== 'object' || event.fields === null) {
    throw new Error('Event fields must be an object.');
  }
  if (typeof event.schemaVersion !== 'number') {
    throw new Error('Event is missing schemaVersion.');
  }
  if (event.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedSchemaError(event.schemaVersion);
  }
}

export function rowKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}
