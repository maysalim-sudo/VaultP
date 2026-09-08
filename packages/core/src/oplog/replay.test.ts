import { describe, expect, it } from 'vitest';
import { HybridClock } from '../clock/hlc.js';
import { encodeHlc } from '../clock/hlc.js';
import { uuidv7 } from '../id.js';
import { type Json, type VaultEvent, createEvent } from './event.js';
import { getRow, isDeleted, materialize, materializeAsOf, rowsOf } from './replay.js';

/** A device that can write events while offline, as the real apps will. */
function device(id: string, startMs = 1_700_000_000_000) {
  let current = startMs;
  const clock = new HybridClock({ device: id, now: () => current });

  return {
    id,
    advance(ms: number) {
      current += ms;
    },
    put(entity: string, entityId: string, fields: Record<string, Json>): VaultEvent {
      const hlc = clock.tick();
      return createEvent({
        entity: entity as never,
        entityId,
        op: 'put',
        fields,
        id: uuidv7(current),
        hlc,
        encodedHlc: encodeHlc(hlc),
      });
    },
    remove(entity: string, entityId: string): VaultEvent {
      const hlc = clock.tick();
      return createEvent({
        entity: entity as never,
        entityId,
        op: 'delete',
        id: uuidv7(current),
        hlc,
        encodedHlc: encodeHlc(hlc),
      });
    },
    sync(event: VaultEvent) {
      clock.receive({
        wallMs: Number(event.hlc.split('|')[0]),
        counter: Number(event.hlc.split('|')[1]),
        device: event.device,
      });
    },
  };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('materialize', () => {
  it('builds a row from its events', () => {
    const phone = device('dev_phone');
    const events = [
      phone.put('expense', 'e1', { amount_minor: 4500, currency: 'TND' }),
      phone.put('expense', 'e1', { note: 'coffee' }),
    ];

    const row = getRow(materialize(events), 'expense', 'e1');

    expect(row?.fields).toMatchObject({
      amount_minor: 4500,
      currency: 'TND',
      note: 'coffee',
    });
  });

  it('applies only the fields present in an event', () => {
    const phone = device('dev_phone');
    const events = [
      phone.put('expense', 'e1', { amount_minor: 4500, note: 'coffee' }),
      phone.put('expense', 'e1', { amount_minor: 5000 }),
    ];

    const row = getRow(materialize(events), 'expense', 'e1');

    // An absent key means untouched, not cleared.
    expect(row?.fields.note).toBe('coffee');
    expect(row?.fields.amount_minor).toBe(5000);
  });

  it('is idempotent under duplicate delivery', () => {
    const phone = device('dev_phone');
    const events = [phone.put('expense', 'e1', { amount_minor: 4500 })];

    const once = materialize(events);
    const twice = materialize([...events, ...events, ...events]);

    expect(twice).toEqual(once);
  });

  it('excludes deleted rows but keeps them recoverable', () => {
    const phone = device('dev_phone');
    const events = [
      phone.put('expense', 'e1', { amount_minor: 4500 }),
      phone.put('expense', 'e2', { amount_minor: 1000 }),
      phone.remove('expense', 'e1'),
    ];

    const store = materialize(events);

    expect(rowsOf(store, 'expense').map((r) => r.id)).toEqual(['e2']);
    expect(isDeleted(getRow(store, 'expense', 'e1')!)).toBe(true);
    // The data is still there — deletion is a marker, not an erasure.
    expect(getRow(store, 'expense', 'e1')?.fields.amount_minor).toBe(4500);
  });

  it('lets a later write undo a delete', () => {
    const phone = device('dev_phone');
    const events = [
      phone.put('expense', 'e1', { amount_minor: 4500 }),
      phone.remove('expense', 'e1'),
      phone.put('expense', 'e1', { deleted_at: null }),
    ];

    expect(isDeleted(getRow(materialize(events), 'expense', 'e1')!)).toBe(false);
  });
});

describe('convergence — the property sync depends on', () => {
  it('produces identical state regardless of arrival order', () => {
    const phone = device('dev_phone');
    const desktop = device('dev_desktop');

    const events = [
      phone.put('category', 'c1', { name: 'Subscriptions' }),
      phone.put('expense', 'e1', { amount_minor: 4500, category_id: 'c1' }),
      desktop.put('expense', 'e2', { amount_minor: 71250, currency: 'TND' }),
      phone.put('expense', 'e1', { note: 'coffee' }),
      desktop.put('category', 'c1', { monthly_limit_minor: 200000 }),
      phone.remove('expense', 'e2'),
    ];

    const reference = materialize(events);

    for (const seed of [1, 7, 42, 99, 12345]) {
      expect(materialize(shuffle(events, seed))).toEqual(reference);
    }
  });

  it('keeps concurrent edits to different fields of the same row', () => {
    const phone = device('dev_phone');
    const desktop = device('dev_desktop');

    const created = phone.put('expense', 'e1', { amount_minor: 4500, note: 'coffee' });
    phone.sync(created);
    desktop.sync(created);

    // Both offline, editing the same expense at the same time.
    const phoneEdit = phone.put('expense', 'e1', { amount_minor: 5000 });
    const desktopEdit = desktop.put('expense', 'e1', { note: 'coffee and croissant' });

    const store = materialize([created, phoneEdit, desktopEdit]);
    const row = getRow(store, 'expense', 'e1')!;

    // Row-level last-write-wins would have discarded one of these.
    expect(row.fields.amount_minor).toBe(5000);
    expect(row.fields.note).toBe('coffee and croissant');
  });

  it('resolves a true conflict on one field the same way on both devices', () => {
    const phone = device('dev_phone');
    const desktop = device('dev_desktop');

    const created = phone.put('expense', 'e1', { amount_minor: 4500 });
    phone.sync(created);
    desktop.sync(created);

    desktop.advance(1000); // desktop wrote later in real time
    const phoneEdit = phone.put('expense', 'e1', { amount_minor: 5000 });
    const desktopEdit = desktop.put('expense', 'e1', { amount_minor: 6000 });

    const onPhone = materialize([created, phoneEdit, desktopEdit]);
    const onDesktop = materialize([desktopEdit, created, phoneEdit]);

    expect(onPhone).toEqual(onDesktop);
    expect(getRow(onPhone, 'expense', 'e1')?.fields.amount_minor).toBe(6000);
  });

  it('does not let a stale offline device resurrect an old value', () => {
    const phone = device('dev_phone');
    const desktop = device('dev_desktop');

    const created = phone.put('expense', 'e1', { amount_minor: 4500 });
    phone.sync(created);
    desktop.sync(created);

    phone.advance(60_000);
    const recent = phone.put('expense', 'e1', { amount_minor: 9000 });

    // Desktop has been offline the whole time and only now writes.
    const stale = desktop.put('expense', 'e1', { amount_minor: 100 });

    const store = materialize([created, recent, stale]);
    expect(getRow(store, 'expense', 'e1')?.fields.amount_minor).toBe(9000);
  });
});

describe('materializeAsOf — history and undo', () => {
  it('reconstructs state at an earlier point', () => {
    const phone = device('dev_phone');

    const created = phone.put('expense', 'e1', { amount_minor: 4500 });
    phone.advance(1000);
    const corrected = phone.put('expense', 'e1', { amount_minor: 5000 });
    phone.advance(1000);
    const removed = phone.remove('expense', 'e1');

    const all = [created, corrected, removed];

    expect(getRow(materializeAsOf(all, created.hlc), 'expense', 'e1')?.fields.amount_minor)
      .toBe(4500);
    expect(getRow(materializeAsOf(all, corrected.hlc), 'expense', 'e1')?.fields.amount_minor)
      .toBe(5000);
    expect(isDeleted(getRow(materialize(all), 'expense', 'e1')!)).toBe(true);
  });
});
