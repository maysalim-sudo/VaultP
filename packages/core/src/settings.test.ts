import { describe, expect, it } from 'vitest';
import { VaultStore } from './db/store.js';
import { openTestDatabase } from './db/testing/nodeSqlite.js';
import { DEFAULT_ALLOWANCE_CONFIG } from './expenses/allowance.js';
import { parseAmount } from './money/money.js';
import {
  isAllowanceConfigured,
  loadAllowanceConfig,
  readSetting,
  saveAllowanceConfig,
  writeSetting,
} from './settings.js';

function newStore(device = 'dev_phone') {
  const db = openTestDatabase();
  return VaultStore.open({ db, device });
}

describe('settings', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(loadAllowanceConfig(newStore())).toEqual(DEFAULT_ALLOWANCE_CONFIG);
  });

  it('round-trips a config', () => {
    const store = newStore();
    const config = {
      ceilingMinor: parseAmount('6000.000', 'TND').amountMinor,
      currency: 'TND',
      yearStartMonth: 1,
    };

    saveAllowanceConfig(store, config);

    expect(loadAllowanceConfig(store)).toEqual(config);
  });

  it('treats a zero ceiling as the feature being off', () => {
    expect(isAllowanceConfigured(DEFAULT_ALLOWANCE_CONFIG)).toBe(false);
    expect(
      isAllowanceConfigured({ ceilingMinor: 1, currency: 'TND', yearStartMonth: 1 }),
    ).toBe(true);
  });

  it('falls back rather than throwing on a corrupt value', () => {
    const store = newStore();
    // As a partly-written or downgraded row might look.
    store.commit('setting', 'allowance', { value: 'not json at all' });

    expect(loadAllowanceConfig(store)).toEqual(DEFAULT_ALLOWANCE_CONFIG);
  });

  it('falls back on a value of the wrong shape', () => {
    const store = newStore();
    writeSetting(store, 'allowance', { ceilingMinor: 'lots', currency: 'TND' });

    expect(loadAllowanceConfig(store)).toEqual(DEFAULT_ALLOWANCE_CONFIG);
  });

  it('rejects a nonsense month rather than accepting it', () => {
    const store = newStore();
    writeSetting(store, 'allowance', {
      ceilingMinor: 1000,
      currency: 'TND',
      yearStartMonth: 13,
    });

    expect(loadAllowanceConfig(store)).toEqual(DEFAULT_ALLOWANCE_CONFIG);
  });

  it('syncs between devices like any other row', () => {
    const phone = newStore('dev_phone');
    const desktop = newStore('dev_desktop');

    saveAllowanceConfig(phone, {
      ceilingMinor: 6_000_000,
      currency: 'TND',
      yearStartMonth: 7,
    });
    desktop.ingest(phone.pendingUploads());

    expect(loadAllowanceConfig(desktop).yearStartMonth).toBe(7);
  });

  it('keeps the history of a changed setting', () => {
    const store = newStore();
    saveAllowanceConfig(store, { ceilingMinor: 1000, currency: 'TND', yearStartMonth: 1 });
    saveAllowanceConfig(store, { ceilingMinor: 2000, currency: 'TND', yearStartMonth: 1 });

    expect(store.historyOf('setting', 'allowance')).toHaveLength(2);
  });

  it('reads an arbitrary setting with a validator', () => {
    const store = newStore();
    writeSetting(store, 'theme', 'dark');

    const isString = (value: unknown): value is string => typeof value === 'string';
    expect(readSetting(store, 'theme', 'light', isString)).toBe('dark');
    expect(readSetting(store, 'missing', 'light', isString)).toBe('light');
  });
});
