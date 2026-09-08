/**
 * Replay: turning an unordered pile of events into rows.
 *
 * The convergence property this file exists to guarantee: given the same set of
 * events, in any arrival order, with any duplicates, every device produces byte
 * for byte the same state. That is what allows sync with no server arbitrating
 * and no conflict prompts shown to the user.
 *
 * Merge granularity is per field, not per row. Editing an expense's amount on
 * the phone while editing its note on the desktop keeps both edits; a row-level
 * last-write-wins would silently discard one of them.
 */

import { DELETED_AT, type Json, type VaultEvent, rowKey } from './event.js';

export interface MaterializedRow {
  readonly entity: string;
  readonly id: string;
  /** Current field values after all merges. */
  readonly fields: Record<string, Json>;
  /** field name -> encoded HLC of the write that last set it. */
  readonly meta: Record<string, string>;
}

export type RowStore = Map<string, MaterializedRow>;

export function isDeleted(row: MaterializedRow): boolean {
  const value = row.fields[DELETED_AT];
  return value !== undefined && value !== null;
}

/**
 * Apply one event to a row. Pure: returns a new row and never mutates the input,
 * so replay can be run speculatively (for previews or undo) without touching
 * committed state.
 */
export function applyEvent(
  existing: MaterializedRow | undefined,
  event: VaultEvent,
): MaterializedRow {
  const row: MaterializedRow = existing ?? {
    entity: event.entity,
    id: event.entityId,
    fields: {},
    meta: {},
  };

  const fields = { ...row.fields };
  const meta = { ...row.meta };

  const incoming: Record<string, Json> =
    event.op === 'delete' ? { [DELETED_AT]: event.hlc } : event.fields;

  for (const [field, value] of Object.entries(incoming)) {
    const seen = meta[field];
    // Strictly greater: an event already applied is idempotent, and two events
    // can never share an HLC because it carries the originating device id.
    if (seen === undefined || event.hlc > seen) {
      fields[field] = value;
      meta[field] = event.hlc;
    }
  }

  return { entity: row.entity, id: row.id, fields, meta };
}

/**
 * Replay events into rows.
 *
 * Sorting by encoded HLC is what makes the result order-independent: the inputs
 * may arrive in any order, but they are always applied in the same one. Sorting
 * is by plain string comparison because the HLC encoding is designed to make
 * lexicographic order match causal order.
 */
export function materialize(
  events: readonly VaultEvent[],
  into: RowStore = new Map(),
): RowStore {
  const seenEventIds = new Set<string>();
  const ordered: VaultEvent[] = [];

  for (const event of events) {
    if (seenEventIds.has(event.id)) continue; // duplicate delivery
    seenEventIds.add(event.id);
    ordered.push(event);
  }

  ordered.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));

  for (const event of ordered) {
    const key = rowKey(event.entity, event.entityId);
    into.set(key, applyEvent(into.get(key), event));
  }

  return into;
}

/** Live rows of one entity type, deleted ones excluded. */
export function rowsOf(store: RowStore, entity: string): MaterializedRow[] {
  const result: MaterializedRow[] = [];
  for (const row of store.values()) {
    if (row.entity === entity && !isDeleted(row)) result.push(row);
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function getRow(
  store: RowStore,
  entity: string,
  id: string,
): MaterializedRow | undefined {
  return store.get(rowKey(entity, id));
}

/**
 * State as of a point in time — the mechanism behind undo, "what did this debt
 * look like in March", and restoring after a bad merge. Nothing needs to be
 * rolled back because nothing was ever overwritten.
 */
export function materializeAsOf(events: readonly VaultEvent[], hlcBound: string): RowStore {
  return materialize(events.filter((event) => event.hlc <= hlcBound));
}
