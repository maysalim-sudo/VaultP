/**
 * Which columns each entity table has.
 *
 * Replay needs this to decide, for every field in an event, whether it maps to a
 * real column or has to be parked. A field this build does not recognise — sent
 * by a newer version of the app on the other device — is kept in `_extra` rather
 * than discarded, so downgrading or syncing from a newer device never loses data
 * silently. Once this build learns the column, the value is already there.
 */

import type { EntityName } from '../oplog/event.js';

export interface EntityDef {
  readonly table: string;
  /** Columns the event fields may write to, excluding id and the internals. */
  readonly columns: readonly string[];
}

const COMMON = ['created_at', 'updated_at', 'deleted_at'] as const;

export const ENTITIES: Partial<Record<EntityName, EntityDef>> = {
  category: {
    table: 'category',
    columns: [
      'name',
      'kind',
      'monthly_limit_minor',
      'rollover',
      'color',
      'icon',
      'sort_order',
      'archived',
      ...COMMON,
    ],
  },
  expense: {
    table: 'expense',
    columns: [
      'occurred_on',
      'amount_minor',
      'currency',
      'fx_rate',
      'fx_estimated',
      'base_amount_minor',
      'category_id',
      'merchant',
      'note',
      'recurring_rule_id',
      'source',
      ...COMMON,
    ],
  },
  recurring_rule: {
    table: 'recurring_rule',
    columns: [
      'name',
      'amount_minor',
      'currency',
      'category_id',
      'frequency',
      'interval_n',
      'anchor_date',
      'next_due_on',
      'auto_log',
      'state',
      'last_seen_amount_minor',
      ...COMMON,
    ],
  },
  person: {
    table: 'person',
    columns: ['name', 'contact', 'note', 'archived', ...COMMON],
  },
  debt_entry: {
    table: 'debt_entry',
    columns: [
      'person_id',
      'kind',
      'direction',
      'amount_minor',
      'currency',
      'occurred_on',
      'note',
      'interest_method',
      'interest_rate',
      'interest_period',
      'settled_on',
      'settlement_of',
      ...COMMON,
    ],
  },
  file: {
    table: 'file',
    columns: [
      'filename',
      'mime',
      'size_bytes',
      'sha256',
      'encrypted_path',
      'width',
      'height',
      ...COMMON,
    ],
  },
  document: {
    table: 'document',
    columns: [
      'title',
      'file_id',
      'extracted_text',
      'expiry_date',
      'reminder_lead_days',
      'note',
      'kind',
      ...COMMON,
    ],
  },
  note: {
    table: 'note',
    columns: ['body', 'due_on', 'notify', 'done', 'done_at', 'pinned', 'colour', ...COMMON],
  },
  tag: {
    table: 'tag',
    columns: ['name', 'colour', ...COMMON],
  },
  tagging: {
    table: 'tagging',
    columns: ['tag_id', 'owner_type', 'owner_id', ...COMMON],
  },
  attachment: {
    table: 'attachment',
    columns: ['owner_type', 'owner_id', 'file_id', 'kind', ...COMMON],
  },
  setting: {
    table: 'setting_row',
    columns: ['value', ...COMMON],
  },
};

export function entityDef(entity: EntityName): EntityDef {
  const def = ENTITIES[entity];
  if (!def) {
    throw new Error(
      `No table is defined for entity "${entity}". Add it to ENTITIES before ` +
        `events of this type can be replayed.`,
    );
  }
  return def;
}

export function isKnownEntity(entity: string): entity is EntityName {
  return Object.prototype.hasOwnProperty.call(ENTITIES, entity);
}

/** Internal columns, never written from event fields. */
export const INTERNAL_COLUMNS = ['id', '_meta', '_extra'] as const;
