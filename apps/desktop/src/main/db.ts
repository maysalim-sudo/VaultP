/**
 * The desktop database.
 *
 * `better-sqlite3-multiple-ciphers` rather than plain better-sqlite3: it is the
 * same library with encryption compiled in, and it reads the SQLCipher format the
 * phone writes. A vault copied between the two must open on both, which rules out
 * any scheme where the desktop invents its own encryption on top.
 */

import Database from 'better-sqlite3-multiple-ciphers';

import type { SqlDatabase, SqlValue } from '@vaultp/core';

export interface OpenOptions {
  readonly path: string;
  /** Raw-key form: x'<64 hex chars>'. Already a uniform HKDF output. */
  readonly encryptionKey: string;
}

export function openDesktopDatabase(options: OpenOptions): SqlDatabase {
  const db = new Database(options.path);

  // Must be the first statement: SQLCipher derives the page cipher from it, and
  // any query before it would be attempted against an undecrypted file.
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key=${JSON.stringify(options.encryptionKey)}`);

  // Fails loudly here if the key is wrong, rather than at some later query with a
  // confusing "file is not a database" error.
  db.prepare('SELECT count(*) FROM sqlite_master').get();

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
      // Savepoints, so a transaction inside a transaction nests rather than
      // throwing — replay and sync both take one, and sync calls replay.
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
