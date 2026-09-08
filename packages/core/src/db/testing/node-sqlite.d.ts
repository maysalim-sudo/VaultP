/**
 * Minimal declarations for Node's built-in SQLite.
 *
 * Declared by hand rather than depending on @types/node, for the same reason as
 * `globals.d.ts`: pulling in the Node types would make `fs`, `path` and `Buffer`
 * type-check everywhere inside core and invite a platform dependency that only
 * fails once it reaches the Android build.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
