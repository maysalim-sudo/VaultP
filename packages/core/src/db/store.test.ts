import { beforeEach, describe, expect, it } from 'vitest';
import { parseAmount } from '../money/money.js';
import { LATEST_VERSION, SchemaTooNewError, currentVersion, migrate } from './migrations.js';
import { VaultStore } from './store.js';
import { openTestDatabase } from './testing/nodeSqlite.js';

function newStore(device: string, startMs = 1_700_000_000_000) {
  let current = startMs;
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device, now: () => current });
  return {
    store,
    db,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe('migrations', () => {
  it('brings a blank database to the latest version', () => {
    const { db } = newStore('dev_a');
    expect(currentVersion(db)).toBe(LATEST_VERSION);
  });

  it('is idempotent when reopened', () => {
    const db = openTestDatabase();
    VaultStore.open({ db, device: 'dev_a' });
    expect(() => VaultStore.open({ db, device: 'dev_a' })).not.toThrow();
    expect(currentVersion(db)).toBe(LATEST_VERSION);
  });
});

describe('writing and reading', () => {
  let ctx: ReturnType<typeof newStore>;

  beforeEach(() => {
    ctx = newStore('dev_phone');
  });

  it('stores an expense in TND millimes and reads it back', () => {
    const amount = parseAmount('4.500', 'TND');
    ctx.store.commit('expense', 'e1', {
      occurred_on: '2026-09-07',
      amount_minor: amount.amountMinor,
      currency: 'TND',
      base_amount_minor: amount.amountMinor,
      merchant: 'Cafe',
    });

    const row = ctx.store.read('expense', 'e1');
    expect(row?.amount_minor).toBe(4500);
    expect(row?.currency).toBe('TND');
    expect(row?.merchant).toBe('Cafe');
  });

  it('sets created_at once and updated_at on every write', () => {
    ctx.store.commit('expense', 'e1', { amount_minor: 4500 });
    const created = ctx.store.read('expense', 'e1')?.created_at;

    ctx.advance(60_000);
    ctx.store.commit('expense', 'e1', { amount_minor: 5000 });
    const after = ctx.store.read('expense', 'e1');

    expect(after?.created_at).toBe(created);
    expect(after?.updated_at).not.toBe(created);
  });

  it('leaves omitted fields untouched', () => {
    ctx.store.commit('expense', 'e1', { amount_minor: 4500, note: 'coffee' });
    ctx.store.commit('expense', 'e1', { amount_minor: 5000 });

    const row = ctx.store.read('expense', 'e1');
    expect(row?.note).toBe('coffee');
    expect(row?.amount_minor).toBe(5000);
  });

  it('appends every mutation to the log', () => {
    ctx.store.commit('expense', 'e1', { amount_minor: 4500 });
    ctx.store.commit('expense', 'e1', { amount_minor: 5000 });
    ctx.store.remove('expense', 'e1');

    const history = ctx.store.historyOf('expense', 'e1');
    expect(history.map((e) => e.op)).toEqual(['put', 'put', 'delete']);
    expect(history[0]?.fields.amount_minor).toBe(4500);
  });

  it('hides a deleted row while keeping its history', () => {
    ctx.store.commit('expense', 'e1', { amount_minor: 4500 });
    ctx.store.remove('expense', 'e1');

    expect(ctx.store.read('expense', 'e1')).toBeUndefined();
    expect(ctx.store.historyOf('expense', 'e1')).toHaveLength(2);
  });
});

describe('forward compatibility', () => {
  it('parks a field this build does not know instead of dropping it', () => {
    const ctx = newStore('dev_phone');

    // As if a newer version of the app on the other device added a column.
    ctx.store.ingest([
      {
        id: '0199c0a0-0000-7000-8000-000000000001',
        hlc: '000001700000000000|00000|dev_desktop',
        device: 'dev_desktop',
        entity: 'expense',
        entityId: 'e1',
        op: 'put',
        fields: { amount_minor: 4500, tip_minor: 500 },
        schemaVersion: 1,
      },
    ]);

    const raw = ctx.db.get<{ _extra: string }>('SELECT _extra FROM expense WHERE id = ?', [
      'e1',
    ]);
    expect(JSON.parse(raw?._extra ?? '{}')).toEqual({ tip_minor: 500 });

    // And it survives a rebuild, so upgrading later recovers the value.
    ctx.store.rebuild();
    const after = ctx.db.get<{ _extra: string }>('SELECT _extra FROM expense WHERE id = ?', [
      'e1',
    ]);
    expect(JSON.parse(after?._extra ?? '{}')).toEqual({ tip_minor: 500 });
  });

  it('refuses an event from a future schema version', () => {
    const ctx = newStore('dev_phone');
    expect(() =>
      ctx.store.ingest([
        {
          id: '0199c0a0-0000-7000-8000-000000000002',
          hlc: '000001700000000000|00000|dev_desktop',
          device: 'dev_desktop',
          entity: 'expense',
          entityId: 'e9',
          op: 'put',
          fields: {},
          schemaVersion: 99,
        },
      ]),
    ).toThrow(/newer version of VaultP/);
  });

  it('refuses a database left by a newer build, without changing it', () => {
    const ctx = newStore('dev_phone');
    ctx.db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    expect(() => migrate(ctx.db)).toThrow(SchemaTooNewError);
    expect(currentVersion(ctx.db)).toBe(LATEST_VERSION + 1);
  });
});

describe('two devices', () => {
  it('converges on the same rows after exchanging events', () => {
    const phone = newStore('dev_phone');
    const desktop = newStore('dev_desktop');

    phone.store.commit('category', 'c1', { name: 'Subscriptions' });
    phone.store.commit('expense', 'e1', {
      amount_minor: 71250,
      currency: 'TND',
      category_id: 'c1',
    });
    desktop.store.commit('expense', 'e2', { amount_minor: 4500, currency: 'TND' });

    // Exchange, in the awkward order a real sync produces.
    desktop.store.ingest(phone.store.pendingUploads());
    phone.store.ingest(desktop.store.pendingUploads());

    for (const ctx of [phone, desktop]) {
      expect(ctx.store.read('expense', 'e1')?.amount_minor).toBe(71250);
      expect(ctx.store.read('expense', 'e2')?.amount_minor).toBe(4500);
      expect(ctx.store.read('category', 'c1')?.name).toBe('Subscriptions');
    }
  });

  it('keeps concurrent edits to different fields of one expense', () => {
    const phone = newStore('dev_phone');
    const desktop = newStore('dev_desktop');

    const created = phone.store.commit('expense', 'e1', {
      amount_minor: 4500,
      note: 'coffee',
    });
    desktop.store.ingest([created]);

    // Both offline.
    phone.store.commit('expense', 'e1', { amount_minor: 5000 });
    desktop.store.commit('expense', 'e1', { note: 'coffee and croissant' });

    const fromPhone = phone.store.pendingUploads();
    const fromDesktop = desktop.store.pendingUploads();
    desktop.store.ingest(fromPhone);
    phone.store.ingest(fromDesktop);

    for (const ctx of [phone, desktop]) {
      const row = ctx.store.read('expense', 'e1');
      expect(row?.amount_minor).toBe(5000);
      expect(row?.note).toBe('coffee and croissant');
    }
  });

  it('is unaffected by a segment delivered twice', () => {
    const phone = newStore('dev_phone');
    const desktop = newStore('dev_desktop');

    phone.store.commit('expense', 'e1', { amount_minor: 4500 });
    const segment = phone.store.pendingUploads();

    expect(desktop.store.ingest(segment)).toBe(1);
    expect(desktop.store.ingest(segment)).toBe(0);
    expect(desktop.store.historyOf('expense', 'e1')).toHaveLength(1);
  });

  it('tracks which local events still need uploading', () => {
    const phone = newStore('dev_phone');
    phone.store.commit('expense', 'e1', { amount_minor: 4500 });
    phone.store.commit('expense', 'e2', { amount_minor: 1000 });

    const pending = phone.store.pendingUploads();
    expect(pending).toHaveLength(2);

    phone.store.markUploaded(pending.map((e) => e.id));
    expect(phone.store.pendingUploads()).toHaveLength(0);

    // Events arriving from elsewhere are not queued for re-upload.
    const desktop = newStore('dev_desktop');
    desktop.store.ingest(pending);
    expect(desktop.store.pendingUploads()).toHaveLength(0);
  });
});

describe('rebuild', () => {
  it('reproduces identical rows from the log alone', () => {
    const ctx = newStore('dev_phone');
    ctx.store.commit('category', 'c1', { name: 'Food', monthly_limit_minor: 400000 });
    ctx.store.commit('expense', 'e1', { amount_minor: 4500, category_id: 'c1' });
    ctx.advance(1000);
    ctx.store.commit('expense', 'e1', { amount_minor: 5000 });
    ctx.store.commit('expense', 'e2', { amount_minor: 1200 });
    ctx.store.remove('expense', 'e2');

    const before = ctx.db.all('SELECT * FROM expense ORDER BY id');
    const categoriesBefore = ctx.db.all('SELECT * FROM category ORDER BY id');

    ctx.store.rebuild();

    expect(ctx.db.all('SELECT * FROM expense ORDER BY id')).toEqual(before);
    expect(ctx.db.all('SELECT * FROM category ORDER BY id')).toEqual(categoriesBefore);
  });
});

describe('SQL reporting', () => {
  it('aggregates by category, which is why rows are materialized at all', () => {
    const ctx = newStore('dev_phone');
    ctx.store.commit('category', 'food', { name: 'Food' });
    ctx.store.commit('category', 'subs', { name: 'Subscriptions' });

    const spend: Array<[string, string, string]> = [
      ['e1', 'food', '4.500'],
      ['e2', 'food', '12.750'],
      ['e3', 'subs', '71.250'],
      ['e4', 'food', '1.000'],
    ];
    for (const [id, category, amount] of spend) {
      ctx.store.commit('expense', id, {
        occurred_on: '2026-09-07',
        category_id: category,
        base_amount_minor: parseAmount(amount, 'TND').amountMinor,
      });
    }
    ctx.store.remove('expense', 'e4');

    const totals = ctx.db.all<{ category_id: string; total: number }>(
      `SELECT category_id, SUM(base_amount_minor) AS total
         FROM expense
        WHERE deleted_at IS NULL AND occurred_on LIKE '2026-09%'
        GROUP BY category_id
        ORDER BY total DESC`,
    );

    expect(totals).toEqual([
      { category_id: 'subs', total: 71250 },
      { category_id: 'food', total: 17250 },
    ]);
  });
});
