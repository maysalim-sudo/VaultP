/**
 * The database seam.
 *
 * Android and Windows use different SQLite drivers (op-sqlite on Hermes,
 * better-sqlite3 on Electron, both with SQLCipher). Everything above this
 * interface is written once and runs on both. Tests use Node's built-in
 * `node:sqlite`, which keeps the suite free of native builds.
 *
 * Deliberately synchronous: both drivers support sync calls, and it keeps replay
 * — which touches many rows per merge — free of promise overhead and of the
 * interleaving hazards an async transaction would introduce.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface SqlDatabase {
  /** Run one or more statements with no parameters and no result. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T[];
  get<T = Record<string, SqlValue>>(
    sql: string,
    params?: readonly SqlValue[],
  ): T | undefined;
  /** Must roll back entirely if `fn` throws. Replay depends on all-or-nothing. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Encode a JS value for a SQLite column. Booleans become 0/1. */
export function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}
