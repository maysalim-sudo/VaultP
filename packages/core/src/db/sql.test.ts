import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './sql.js';

describe('splitSqlStatements', () => {
  it('splits plain statements', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('ignores trailing separators and blank statements', () => {
    expect(splitSqlStatements('SELECT 1;;  ;')).toEqual(['SELECT 1']);
    expect(splitSqlStatements('   ')).toEqual([]);
  });

  it('does not split on a semicolon inside a line comment', () => {
    // The exact shape that broke the debts migration on device: the driver saw a
    // truncated CREATE TABLE and reported only "incomplete input".
    const sql = `
      CREATE TABLE debt_entry (
        id TEXT PRIMARY KEY,
        -- Set when a settlement closes this loan; interest stops on that date.
        settled_on TEXT
      );
      CREATE INDEX debt_entry_person ON debt_entry(id);
    `;

    const statements = splitSqlStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('settled_on TEXT');
    expect(statements[1]).toContain('CREATE INDEX');
  });

  it('does not split on a semicolon inside a block comment', () => {
    const sql = `CREATE TABLE a (id TEXT /* one; two */); SELECT 1;`;
    expect(splitSqlStatements(sql)).toHaveLength(2);
  });

  it('does not split on a semicolon inside a string literal', () => {
    const statements = splitSqlStatements(`INSERT INTO t VALUES ('a;b'); SELECT 1;`);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
  });

  it('handles an escaped quote inside a string literal', () => {
    const statements = splitSqlStatements(`INSERT INTO t VALUES ('it''s; fine'); SELECT 1;`);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'it''s; fine'");
  });

  it('does not split on a semicolon inside a quoted identifier', () => {
    const statements = splitSqlStatements(`CREATE TABLE "odd;name" (id TEXT); SELECT 1;`);
    expect(statements).toHaveLength(2);
  });

  it('keeps comments, so a failing statement still explains itself', () => {
    const statements = splitSqlStatements(`-- why this table exists\nCREATE TABLE a (id TEXT);`);
    expect(statements[0]).toContain('why this table exists');
  });

  it('tolerates an unterminated comment or literal without looping', () => {
    expect(splitSqlStatements('SELECT 1; -- trailing comment')).toHaveLength(2);
    expect(splitSqlStatements("SELECT 'unclosed")).toHaveLength(1);
    expect(splitSqlStatements('SELECT 1; /* unclosed')).toHaveLength(2);
  });

  it('splits every statement in the real migration script', () => {
    // Guards against a future migration reintroducing the same shape.
    const sql = `
      CREATE TABLE person (
        id TEXT PRIMARY KEY,
        _meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE debt_entry (
        id TEXT PRIMARY KEY,
        -- a repayment is its own row; never an edit to the loan
        kind TEXT,
        _meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX debt_entry_kind ON debt_entry(kind);
    `;

    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.startsWith('CREATE') || statement.includes('CREATE')).toBe(true);
    }
  });
});
