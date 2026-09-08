/**
 * A SqlDatabase backed by Node's built-in SQLite. TEST USE ONLY.
 *
 * Keeps the suite free of native builds, so `npm test` works on a fresh clone
 * with no toolchain. It has no SQLCipher, so it must never ship in an app — the
 * real drivers are op-sqlite (Android) and better-sqlite3 (Electron), both with
 * encryption enabled. Not exported from the package index.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlValue } from '../adapter.js';

export function openTestDatabase(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');

  // Savepoints rather than plain BEGIN, so a transaction inside a transaction
  // behaves sensibly instead of throwing.
  let depth = 0;

  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
    get<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).get(...(params as unknown[])) as T | undefined;
    },
    transaction<T>(fn: () => T): T {
      const name = `sp_${depth}`;
      db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
