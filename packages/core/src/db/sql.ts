/**
 * Splitting a multi-statement SQL script.
 *
 * Migrations are written as one readable block, but most SQLite drivers execute a
 * single statement per call, so the script has to be split. Splitting naively on
 * ';' is wrong in three ways, and the third one shipped a bug: a semicolon inside
 * a line comment cut a CREATE TABLE in half, and the driver reported only
 * "incomplete input".
 *
 * So the scan tracks what it is inside of:
 *
 *   'text'        string literals, where '' is an escaped quote
 *   "identifier"  quoted identifiers
 *   -- comment    to end of line
 *   /* comment *​/ to the closing marker
 *
 * Comments are kept in the output rather than stripped: when a migration fails,
 * the driver echoes the statement it choked on, and the comment explaining what
 * that table is for is worth having in the error.
 */

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    // Line comment: everything to the newline is literal text, semicolons included.
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', index);
      const end = newline === -1 ? sql.length : newline + 1;
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    // Block comment.
    if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      const end = close === -1 ? sql.length : close + 2;
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    // Quoted string or identifier. A doubled quote inside is an escaped quote,
    // not the end of the literal.
    if (char === "'" || char === '"') {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === char) {
          if (sql[cursor + 1] === char) {
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      current += sql.slice(index, cursor);
      index = cursor;
      continue;
    }

    if (char === ';') {
      if (current.trim() !== '') statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim() !== '') statements.push(current.trim());
  return statements;
}
