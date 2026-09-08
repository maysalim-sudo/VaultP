/**
 * VaultStore — the only thing in the app that writes data.
 *
 * Every mutation goes: build event -> append to `oplog` -> merge into the
 * materialized table. The tables exist purely so SQL can answer questions like
 * "total per category last month"; they can be deleted and rebuilt from the log
 * at any time. That is what `rebuild()` is for, and it is why a schema change
 * never risks the data.
 */

import { type Hlc, HybridClock, decodeHlc, encodeHlc } from '../clock/hlc.js';
import { uuidv7 } from '../id.js';
import {
  DELETED_AT,
  type EntityName,
  type Json,
  type VaultEvent,
  assertValidEvent,
  createEvent,
} from '../oplog/event.js';
import { type MaterializedRow, applyEvent } from '../oplog/replay.js';
import { type SqlDatabase, type SqlValue, toSqlValue } from './adapter.js';
import { entityDef } from './entities.js';
import { migrate } from './migrations.js';

export interface VaultStoreOptions {
  readonly db: SqlDatabase;
  readonly device: string;
  readonly now?: () => number;
}

interface OplogRow {
  id: string;
  hlc: string;
  device: string;
  entity: string;
  entity_id: string;
  op: string;
  fields: string;
  schema_version: number;
}

function parseJsonObject(value: SqlValue | undefined): Record<string, Json> {
  if (typeof value !== 'string' || value === '') return {};
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, Json>)
    : {};
}

export class VaultStore {
  private readonly db: SqlDatabase;
  private readonly clock: HybridClock;
  readonly device: string;

  private constructor(options: VaultStoreOptions, state: Hlc | undefined) {
    this.db = options.db;
    this.device = options.device;
    this.clock = new HybridClock(
      options.now ? { device: options.device, now: options.now } : { device: options.device },
      state,
    );
  }

  /** Migrate, restore the clock, and return a ready store. */
  static open(options: VaultStoreOptions): VaultStore {
    migrate(options.db);
    const saved = options.db.get<{ wall_ms: number; counter: number }>(
      'SELECT wall_ms, counter FROM clock_state WHERE id = 1',
    );
    const state: Hlc | undefined = saved
      ? { wallMs: saved.wall_ms, counter: saved.counter, device: options.device }
      : undefined;
    return new VaultStore(options, state);
  }

  // ---------------------------------------------------------------- writing

  /**
   * Record a local change. Only the fields given are written; anything omitted
   * is left untouched rather than cleared, which is what makes concurrent edits
   * to different fields of one row merge cleanly.
   */
  commit(
    entity: EntityName,
    entityId: string,
    fields: Readonly<Record<string, Json>>,
  ): VaultEvent {
    entityDef(entity); // fail fast on an entity with no table

    const hlc = this.clock.tick();
    // Stamped here rather than at apply time so replay stays deterministic: every
    // device applying this event produces byte-identical rows.
    const timestamp = new Date(hlc.wallMs).toISOString();
    const stamped: Record<string, Json> = { ...fields, updated_at: timestamp };
    if (!this.exists(entity, entityId) && stamped.created_at === undefined) {
      stamped.created_at = timestamp;
    }

    const event = createEvent({
      entity,
      entityId,
      op: 'put',
      fields: stamped,
      id: uuidv7(hlc.wallMs),
      hlc,
      encodedHlc: encodeHlc(hlc),
    });

    this.db.transaction(() => {
      this.apply(event);
      this.saveClock();
    });
    return event;
  }

  /** Soft delete. The row and its history stay; only its visibility changes. */
  remove(entity: EntityName, entityId: string): VaultEvent {
    const hlc = this.clock.tick();
    const event = createEvent({
      entity,
      entityId,
      op: 'delete',
      id: uuidv7(hlc.wallMs),
      hlc,
      encodedHlc: encodeHlc(hlc),
    });

    this.db.transaction(() => {
      this.apply(event);
      this.saveClock();
    });
    return event;
  }

  /**
   * Merge events from another device. Idempotent, so re-downloading a segment or
   * interrupting a sync halfway costs nothing but time.
   */
  ingest(events: readonly VaultEvent[]): number {
    let applied = 0;
    this.db.transaction(() => {
      // Apply in HLC order so a row never briefly holds a value that a device
      // replaying the same events in a different order would not have seen.
      const ordered = [...events].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
      for (const event of ordered) {
        assertValidEvent(event);
        if (event.device !== this.device) this.clock.receive(decodeHlc(event.hlc));
        if (this.apply(event)) applied += 1;
      }
      this.saveClock();
    });
    return applied;
  }

  /** @returns false if this event was already in the log. */
  private apply(event: VaultEvent): boolean {
    const seen = this.db.get<{ one: number }>('SELECT 1 AS one FROM oplog WHERE id = ?', [
      event.id,
    ]);
    if (seen) return false;

    this.db.run(
      `INSERT INTO oplog (id, hlc, device, entity, entity_id, op, fields, schema_version, uploaded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.hlc,
        event.device,
        event.entity,
        event.entityId,
        event.op,
        JSON.stringify(event.fields),
        event.schemaVersion,
        event.device === this.device ? 0 : 1,
      ],
    );

    this.materialize(event);
    return true;
  }

  private materialize(event: VaultEvent): void {
    const def = entityDef(event.entity);
    const existing = this.readRow(event.entity, event.entityId);
    const merged = applyEvent(existing, event);
    this.writeRow(def.table, def.columns, merged);
  }

  private readRow(entity: EntityName, id: string): MaterializedRow | undefined {
    const def = entityDef(entity);
    const row = this.db.get<Record<string, SqlValue>>(
      `SELECT * FROM ${def.table} WHERE id = ?`,
      [id],
    );
    if (!row) return undefined;

    const meta = parseJsonObject(row._meta) as Record<string, string>;
    const extra = parseJsonObject(row._extra);
    const known = new Set(def.columns);

    // Rebuild from the meta keys, not from every non-null column: a column that
    // was never written is absent, not null. The distinction matters for merge.
    const fields: Record<string, Json> = {};
    for (const field of Object.keys(meta)) {
      fields[field] = known.has(field)
        ? ((row[field] ?? null) as Json)
        : (extra[field] ?? null);
    }

    return { entity, id, fields, meta };
  }

  private writeRow(
    table: string,
    columns: readonly string[],
    row: MaterializedRow,
  ): void {
    const known = new Set(columns);
    const columnNames: string[] = [];
    const values: SqlValue[] = [];
    const extra: Record<string, Json> = {};

    for (const [field, value] of Object.entries(row.fields)) {
      if (known.has(field)) {
        columnNames.push(field);
        values.push(toSqlValue(value));
      } else {
        // A field from a newer app version. Parked rather than dropped.
        extra[field] = value;
      }
    }

    const allColumns = ['id', ...columnNames, '_meta', '_extra'];
    const placeholders = allColumns.map(() => '?').join(', ');
    const assignments = [...columnNames, '_meta', '_extra']
      .map((name) => `${name} = excluded.${name}`)
      .join(', ');

    this.db.run(
      `INSERT INTO ${table} (${allColumns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${assignments}`,
      [row.id, ...values, JSON.stringify(row.meta), JSON.stringify(extra)],
    );
  }

  private exists(entity: EntityName, id: string): boolean {
    const def = entityDef(entity);
    return (
      this.db.get<{ one: number }>(`SELECT 1 AS one FROM ${def.table} WHERE id = ?`, [id]) !==
      undefined
    );
  }

  private saveClock(): void {
    const { wallMs, counter } = this.clock.state;
    this.db.run(
      `INSERT INTO clock_state (id, wall_ms, counter) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET wall_ms = excluded.wall_ms, counter = excluded.counter`,
      [wallMs, counter],
    );
  }

  // ---------------------------------------------------------------- reading

  /**
   * Read-only access for query modules (reports, budgets, allowance).
   *
   * Reads are ordinary SQL against the materialized tables. Writes must still go
   * through commit/remove so that nothing bypasses the event log.
   */
  get database(): SqlDatabase {
    return this.db;
  }

  /** Live row as plain values, or undefined if absent or deleted. */
  read(entity: EntityName, id: string): Record<string, SqlValue> | undefined {
    const def = entityDef(entity);
    const row = this.db.get<Record<string, SqlValue>>(
      `SELECT * FROM ${def.table} WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row;
  }

  /** Full history of one row, oldest first. The audit trail. */
  historyOf(entity: EntityName, id: string): VaultEvent[] {
    const rows = this.db.all<OplogRow>(
      `SELECT * FROM oplog WHERE entity = ? AND entity_id = ? ORDER BY hlc ASC`,
      [entity, id],
    );
    return rows.map(decodeOplogRow);
  }

  allEvents(): VaultEvent[] {
    return this.db
      .all<OplogRow>('SELECT * FROM oplog ORDER BY hlc ASC')
      .map(decodeOplogRow);
  }

  // ------------------------------------------------------------------- sync

  /** Local events not yet pushed to cloud storage, in log order. */
  pendingUploads(limit = 500): VaultEvent[] {
    return this.db
      .all<OplogRow>('SELECT * FROM oplog WHERE uploaded = 0 ORDER BY seq ASC LIMIT ?', [
        limit,
      ])
      .map(decodeOplogRow);
  }

  markUploaded(eventIds: readonly string[]): void {
    if (eventIds.length === 0) return;
    this.db.transaction(() => {
      for (const id of eventIds) {
        this.db.run('UPDATE oplog SET uploaded = 1 WHERE id = ?', [id]);
      }
    });
  }

  /**
   * Discard the materialized tables and replay the log.
   *
   * Safe by construction, because the tables were only ever a cache. This is the
   * repair path after a schema change or a bug in a merge rule.
   */
  rebuild(): void {
    this.db.transaction(() => {
      const events = this.allEvents();
      const tables = new Set(events.map((event) => entityDef(event.entity).table));
      for (const table of tables) this.db.run(`DELETE FROM ${table}`);
      for (const event of events) this.materialize(event);
    });
  }
}

function decodeOplogRow(row: OplogRow): VaultEvent {
  return {
    id: row.id,
    hlc: row.hlc,
    device: row.device,
    entity: row.entity as EntityName,
    entityId: row.entity_id,
    op: row.op as 'put' | 'delete',
    fields: JSON.parse(row.fields) as Record<string, Json>,
    schemaVersion: row.schema_version,
  };
}

export { DELETED_AT };
