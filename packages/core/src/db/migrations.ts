/**
 * Schema migrations, tracked with SQLite's `user_version`.
 *
 * Migrations only ever add. Because the vault's real source of truth is the event
 * log rather than these tables, a schema change that cannot be expressed as an
 * ALTER can instead drop the materialized tables and replay — the data is not in
 * them, it is in `oplog`.
 */

import type { SqlDatabase } from './adapter.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (db: SqlDatabase) => void;
}

/**
 * Columns every entity table carries:
 *   deleted_at  soft delete; hard deletion would break the audit trail
 *   _meta       field -> HLC of the write that last set it, for per-field merge
 *   _extra      fields from a newer app version this build does not know yet
 */
const ENTITY_INTERNALS = `
  deleted_at TEXT,
  _meta TEXT NOT NULL DEFAULT '{}',
  _extra TEXT NOT NULL DEFAULT '{}'
`;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'expenses',
    up(db) {
      db.exec(`
        CREATE TABLE oplog (
          seq            INTEGER PRIMARY KEY AUTOINCREMENT,
          id             TEXT NOT NULL UNIQUE,
          hlc            TEXT NOT NULL,
          device         TEXT NOT NULL,
          entity         TEXT NOT NULL,
          entity_id      TEXT NOT NULL,
          op             TEXT NOT NULL,
          fields         TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          uploaded       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX oplog_hlc ON oplog(hlc);
        CREATE INDEX oplog_pending ON oplog(uploaded, seq);
        CREATE INDEX oplog_entity ON oplog(entity, entity_id, hlc);

        CREATE TABLE sync_cursor (
          device       TEXT PRIMARY KEY,
          last_segment TEXT NOT NULL
        );

        CREATE TABLE device (
          id         TEXT PRIMARY KEY,
          label      TEXT,
          platform   TEXT,
          created_at TEXT
        );

        CREATE TABLE clock_state (
          id      INTEGER PRIMARY KEY CHECK (id = 1),
          wall_ms INTEGER NOT NULL,
          counter INTEGER NOT NULL
        );

        CREATE TABLE setting_row (
          id         TEXT PRIMARY KEY,
          value      TEXT,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );

        CREATE TABLE category (
          id                  TEXT PRIMARY KEY,
          name                TEXT,
          kind                TEXT,
          monthly_limit_minor INTEGER,
          rollover            INTEGER,
          color               TEXT,
          icon                TEXT,
          sort_order          INTEGER,
          archived            INTEGER,
          created_at          TEXT,
          updated_at          TEXT,
          ${ENTITY_INTERNALS}
        );

        CREATE TABLE expense (
          id                TEXT PRIMARY KEY,
          occurred_on       TEXT,
          amount_minor      INTEGER,
          currency          TEXT,
          fx_rate           REAL,
          base_amount_minor INTEGER,
          category_id       TEXT,
          merchant          TEXT,
          note              TEXT,
          recurring_rule_id TEXT,
          source            TEXT,
          created_at        TEXT,
          updated_at        TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX expense_occurred_on ON expense(occurred_on);
        CREATE INDEX expense_category ON expense(category_id, occurred_on);

        CREATE TABLE recurring_rule (
          id                     TEXT PRIMARY KEY,
          name                   TEXT,
          amount_minor           INTEGER,
          currency               TEXT,
          category_id            TEXT,
          frequency              TEXT,
          interval_n             INTEGER,
          anchor_date            TEXT,
          next_due_on            TEXT,
          auto_log               INTEGER,
          state                  TEXT,
          last_seen_amount_minor INTEGER,
          created_at             TEXT,
          updated_at             TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX recurring_rule_due ON recurring_rule(state, next_due_on);
      `);
    },
  },
  {
    version: 2,
    name: 'estimated-conversions',
    up(db) {
      // A foreign charge is often logged before the bank statement shows what was
      // actually debited. Such rows carry an estimated base amount, flagged here so
      // reports can say "3 amounts still estimated" instead of quietly presenting a
      // guess as fact.
      db.exec(`ALTER TABLE expense ADD COLUMN fx_estimated INTEGER`);
    },
  },
  {
    version: 3,
    name: 'debts',
    up(db) {
      db.exec(`
        CREATE TABLE person (
          id         TEXT PRIMARY KEY,
          name       TEXT,
          contact    TEXT,
          note       TEXT,
          archived   INTEGER,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );

        -- Append-only in spirit: a repayment is its own row, never an edit to the
        -- loan it pays down. This is the module most likely to matter in a
        -- disagreement, so the history has to be the data rather than a side note.
        CREATE TABLE debt_entry (
          id              TEXT PRIMARY KEY,
          person_id       TEXT,
          kind            TEXT,     -- loan | payment | adjustment | settlement
          direction       TEXT,     -- owed_to_me | owed_by_me
          amount_minor    INTEGER,
          currency        TEXT,
          occurred_on     TEXT,
          note            TEXT,
          -- Interest terms live on the loan they belong to, so two loans to the
          -- same person can carry different rates.
          interest_method TEXT,
          interest_rate   REAL,
          interest_period TEXT,
          -- Set when a settlement closes this loan; interest stops on that date.
          settled_on      TEXT,
          settlement_of   TEXT,
          created_at      TEXT,
          updated_at      TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX debt_entry_person ON debt_entry(person_id, occurred_on);
        CREATE INDEX debt_entry_kind ON debt_entry(kind, occurred_on);
      `);
    },
  },
  {
    version: 4,
    name: 'documents',
    up(db) {
      db.exec(`
        -- File bytes never live in the database. A scan is several megabytes, and
        -- putting those in SQLite bloats every query, every backup and every sync
        -- segment. The bytes sit on disk, encrypted; this row is the metadata.
        CREATE TABLE file (
          id             TEXT PRIMARY KEY,
          filename       TEXT,
          mime           TEXT,
          size_bytes     INTEGER,
          -- Of the plaintext, so the same scan added twice is recognised even
          -- though the two ciphertexts differ.
          sha256         TEXT,
          encrypted_path TEXT,
          width          INTEGER,
          height         INTEGER,
          created_at     TEXT,
          updated_at     TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX file_sha256 ON file(sha256);

        CREATE TABLE document (
          id                 TEXT PRIMARY KEY,
          title              TEXT,
          file_id            TEXT,
          -- OCR output, indexed for search. Encrypted with the database, so the
          -- index is never a plaintext copy of your papers sitting beside them.
          extracted_text     TEXT,
          expiry_date        TEXT,
          reminder_lead_days INTEGER,
          note               TEXT,
          kind               TEXT,
          created_at         TEXT,
          updated_at         TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX document_expiry ON document(expiry_date);

        CREATE TABLE tag (
          id         TEXT PRIMARY KEY,
          name       TEXT,
          colour     TEXT,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );

        -- Many-to-many, and deliberately not folders: a passport is 'travel' and
        -- 'identity' and '2026' at once, and a folder would force a choice.
        CREATE TABLE tagging (
          id         TEXT PRIMARY KEY,
          tag_id     TEXT,
          owner_type TEXT,
          owner_id   TEXT,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX tagging_owner ON tagging(owner_type, owner_id);
        CREATE INDEX tagging_tag ON tagging(tag_id);

        -- The cross-module link: a receipt on an expense, a scan on a document.
        CREATE TABLE attachment (
          id         TEXT PRIMARY KEY,
          owner_type TEXT,
          owner_id   TEXT,
          file_id    TEXT,
          kind       TEXT,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX attachment_owner ON attachment(owner_type, owner_id);
      `);
    },
  },
  {
    version: 5,
    name: 'notes',
    up(db) {
      db.exec(`
        CREATE TABLE note (
          id         TEXT PRIMARY KEY,
          body       TEXT,
          -- Two independent switches, not one. A note can carry a due date with no
          -- notification (a date you want to see in the list), or a notification
          -- without being a to-do. Collapsing them into one setting forces a
          -- choice neither case wants.
          due_on     TEXT,
          notify     INTEGER,
          done       INTEGER,
          done_at    TEXT,
          pinned     INTEGER,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );
        CREATE INDEX note_due ON note(done, due_on);
      `);
    },
  },
  {
    version: 6,
    name: 'note-colour',
    up(db) {
      // A name ('yellow', 'teal'…) rather than a hex value: each theme maps it to
      // its own shade, so a note chosen on a light phone still reads on a dark
      // desktop.
      db.exec(`ALTER TABLE note ADD COLUMN colour TEXT`);

      // A newer build on the other device may already have written a colour,
      // which this one parked in _extra because it had no column for it. The
      // note repository reads columns directly, so without this the new, empty
      // column would hide that value until the note happened to be edited again.
      promoteParked(db, 'note', ['colour']);
    },
  },
  {
    version: 7,
    name: 'rich-notes',
    up(db) {
      // `content` is the note as blocks (JSON); `body` stays, derived from it on
      // every write, as the plain text search reads and older builds display.
      db.exec(`
        ALTER TABLE note ADD COLUMN title TEXT;
        ALTER TABLE note ADD COLUMN content TEXT;
        ALTER TABLE note ADD COLUMN archived INTEGER;
      `);
      promoteParked(db, 'note', ['title', 'content', 'archived']);
    },
  },
  {
    version: 8,
    name: 'note-folders',
    up(db) {
      // A folder holds notes; a note is in one folder or none. Labels stay as
      // they were — several per note — for the cross-cutting "travel", "2026".
      //
      // `position` is the order you dragged notes into: a fraction, so moving
      // one note between two others writes one row rather than renumbering the
      // list, and two devices reordering offline cannot collide on a number.
      db.exec(`
        CREATE TABLE folder (
          id         TEXT PRIMARY KEY,
          name       TEXT,
          colour     TEXT,
          sort_order REAL,
          created_at TEXT,
          updated_at TEXT,
          ${ENTITY_INTERNALS}
        );
        ALTER TABLE note ADD COLUMN folder_id TEXT;
        ALTER TABLE note ADD COLUMN position REAL;
        CREATE INDEX note_folder ON note(folder_id);
      `);
      promoteParked(db, 'note', ['folder_id', 'position']);
    },
  },
];

/**
 * Move values parked in `_extra` into columns that now exist for them.
 *
 * A newer build on the other device may have written a field before this one
 * had a column for it; replay parked it rather than dropping it. Repositories
 * read columns, so without this the value would stay invisible until the row
 * happened to be written again.
 */
function promoteParked(db: SqlDatabase, table: string, columns: readonly string[]): void {
  const parked = db.all<{ id: string; _extra: string | null }>(
    `SELECT id, _extra FROM ${table} WHERE ${columns.map(() => `_extra LIKE ?`).join(' OR ')}`,
    columns.map((column) => `%"${column}"%`),
  );

  for (const row of parked) {
    const extra = JSON.parse(row._extra ?? '{}') as Record<string, unknown>;
    const present = columns.filter((column) => column in extra);
    if (present.length === 0) continue;

    const values = present.map((column) => {
      const value = extra[column];
      delete extra[column];
      if (typeof value === 'boolean') return value ? 1 : 0;
      return typeof value === 'string' || typeof value === 'number' ? value : null;
    });

    db.run(
      `UPDATE ${table} SET ${present.map((column) => `${column} = ?`).join(', ')}, _extra = ? WHERE id = ?`,
      [...values, JSON.stringify(extra), row.id],
    );
  }
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export class SchemaTooNewError extends Error {
  constructor(found: number) {
    super(
      `Database schema is version ${found}, newer than this build understands ` +
        `(${LATEST_VERSION}). Update the app rather than risk writing rows the ` +
        `newer version cannot read back.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

export function currentVersion(db: SqlDatabase): number {
  const row = db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Bring the schema up to date.
 *
 * `upTo` exists so a test can build a database exactly as an older release left
 * it, and then prove the upgrade from there. The app always migrates fully.
 */
export function migrate(db: SqlDatabase, upTo: number = LATEST_VERSION): number {
  const from = currentVersion(db);
  if (from > LATEST_VERSION) throw new SchemaTooNewError(from);

  for (const migration of MIGRATIONS) {
    if (migration.version <= from || migration.version > upTo) continue;
    db.transaction(() => {
      migration.up(db);
      // PRAGMA does not accept parameters; the value is a literal from our own
      // migration list, never user input.
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return LATEST_VERSION;
}
