/**
 * Settings.
 *
 * Stored as ordinary rows so they travel through the same event log as everything
 * else: changing the allowance ceiling on the desktop reaches the phone by the
 * same path an expense does, and the change is in the history like any other.
 *
 * Values are JSON text rather than typed columns. Settings change shape often, and
 * a migration per preference would be a poor trade; the cost is that every read
 * has to cope with text written by an older or newer version, which is what
 * `readSetting` does.
 */

import type { VaultStore } from './db/store.js';
import {
  type AllowanceConfig,
  DEFAULT_ALLOWANCE_CONFIG,
} from './expenses/allowance.js';

export const SETTING_KEYS = {
  allowance: 'allowance',
  baseCurrency: 'base_currency',
} as const;

/**
 * Read and parse a setting.
 *
 * Returns the fallback on anything unexpected — absent, unparseable, or written by
 * a version that stored a different shape. A settings row must never be able to
 * stop the app opening.
 */
export function readSetting<T>(
  store: VaultStore,
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T,
): T {
  const row = store.read('setting', key);
  const raw = row?.value;
  if (typeof raw !== 'string' || raw === '') return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(store: VaultStore, key: string, value: unknown): void {
  store.commit('setting', key, { value: JSON.stringify(value) });
}

function isAllowanceConfig(value: unknown): value is AllowanceConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<AllowanceConfig>;
  return (
    typeof config.ceilingMinor === 'number' &&
    Number.isFinite(config.ceilingMinor) &&
    typeof config.currency === 'string' &&
    typeof config.yearStartMonth === 'number' &&
    config.yearStartMonth >= 1 &&
    config.yearStartMonth <= 12
  );
}

export function loadAllowanceConfig(store: VaultStore): AllowanceConfig {
  return readSetting(
    store,
    SETTING_KEYS.allowance,
    DEFAULT_ALLOWANCE_CONFIG,
    isAllowanceConfig,
  );
}

export function saveAllowanceConfig(store: VaultStore, config: AllowanceConfig): void {
  writeSetting(store, SETTING_KEYS.allowance, config);
}

/** A ceiling of zero means the feature is off, not that nothing may be spent. */
export function isAllowanceConfigured(config: AllowanceConfig): boolean {
  return config.ceilingMinor > 0;
}
