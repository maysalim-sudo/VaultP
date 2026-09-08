/**
 * The Android half of the database seam.
 *
 * `core` defines `SqlDatabase`; this implements it with op-sqlite, built with
 * SQLCipher so the file on disk is AES-256 encrypted. Nothing above this file
 * knows which driver is underneath — the Windows app will drop in better-sqlite3
 * against the same interface.
 *
 * Synchronous throughout. op-sqlite exposes sync calls, and replay touches many
 * rows per merge, so promises would add overhead and a chance for two merges to
 * interleave inside a transaction.
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import { splitSqlStatements, type SqlDatabase, type SqlValue } from '@vaultp/core';

export interface OpenOptions {
  readonly name: string;
  /**
   * SQLCipher key. Absent means an unencrypted file, which is only ever correct
   * for throwaway debugging — never for a real vault.
   */
  readonly encryptionKey?: string;
}

type RowLike = Record<string, SqlValue>;

/** op-sqlite has changed its result shape across versions; accept both. */
function rowsOf(result: unknown): RowLike[] {
  const rows = (result as { rows?: unknown })?.rows;
  if (Array.isArray(rows)) return rows as RowLike[];
  const legacy = (rows as { _array?: unknown } | undefined)?._array;
  return Array.isArray(legacy) ? (legacy as RowLike[]) : [];
}

export function openVaultDatabase(options: OpenOptions): SqlDatabase {
  const db: DB = open(
    options.encryptionKey
      ? { name: options.name, encryptionKey: options.encryptionKey }
      : { name: options.name },
  );

  // Write-ahead logging: a crash mid-write leaves the database consistent, and
  // reads do not block on the write that a sync merge is doing.
  db.executeSync('PRAGMA journal_mode = WAL');
  db.executeSync('PRAGMA foreign_keys = ON');

  // Savepoints rather than plain BEGIN, so a transaction inside a transaction
  // behaves instead of throwing. Migrations and ingest both nest.
  let depth = 0;

  return {
    exec(sql: string): void {
      // A migration arrives as several statements in one string; op-sqlite runs
      // one at a time, so split on semicolons that end a statement.
      for (const statement of splitSqlStatements(sql)) {
        db.executeSync(statement);
      }
    },

    run(sql: string, params: readonly SqlValue[] = []): void {
      db.executeSync(sql, params as SqlValue[]);
    },

    all<T = RowLike>(sql: string, params: readonly SqlValue[] = []): T[] {
      return rowsOf(db.executeSync(sql, params as SqlValue[])) as T[];
    },

    get<T = RowLike>(sql: string, params: readonly SqlValue[] = []): T | undefined {
      return rowsOf(db.executeSync(sql, params as SqlValue[]))[0] as T | undefined;
    },

    transaction<T>(fn: () => T): T {
      const name = `sp_${depth}`;
      db.executeSync(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.executeSync(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        db.executeSync(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw error;
      }
    },

    close(): void {
      db.close();
    },
  };
}
