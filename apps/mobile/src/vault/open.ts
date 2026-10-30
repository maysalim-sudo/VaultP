/**
 * Opening the vault on device.
 *
 * The data key arrives from `keys.ts` — either unwrapped with the passphrase or
 * released by the Keystore after a fingerprint. Everything the database and files
 * use is derived from it, and none of those derived keys is ever stored.
 *
 * The decoy vault is a second database file, opened with a key derived from a
 * different data key. Nothing else about the app changes: the same screens, the
 * same code, over an empty vault.
 */

import {
  AccountRepository,
  ExpenseRepository,
  DebtRepository,
  DocumentRepository,
  NoteRepository,
  VaultStore,
  deriveVaultKeys,
  toSqlCipherKey,
  type SqlDatabase,
  type SlotId,
  type VaultKeys,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';
import { openVaultDatabase } from '../db/opSqliteAdapter.js';
import type { VaultKeyMaterial } from './keys.js';

const DATABASE_NAME = 'vaultp.db';
/** A separate file, so the decoy cannot see the real vault's rows at all. */
const DECOY_DATABASE_NAME = 'vaultp-decoy.db';

export interface OpenVault {
  readonly db: SqlDatabase;
  readonly store: VaultStore;
  readonly expenses: ExpenseRepository;
  readonly debts: DebtRepository;
  readonly documents: DocumentRepository;
  readonly notes: NoteRepository;
  readonly accounts: AccountRepository;
  /** Needed to encrypt attachments; the database key is already applied. */
  readonly keys: VaultKeys;
  /**
   * The root key, held in memory while the vault is open. Its one use beyond
   * deriving the keys above is unlocking a paired computer, sealed to it and
   * only after a fingerprint. Never written anywhere by this app.
   */
  readonly dataKey: Uint8Array;
  readonly deviceId: string;
  /** Which vault is open. The UI does not distinguish them; the data does. */
  readonly slot: SlotId;
}

export async function openVault(material: VaultKeyMaterial): Promise<OpenVault> {
  const keys = await deriveVaultKeys(androidCryptoProvider, material.dataKey);

  const db = openVaultDatabase({
    name: material.slot === 'decoy' ? DECOY_DATABASE_NAME : DATABASE_NAME,
    // Raw-key form, so SQLCipher uses these 32 bytes directly instead of running
    // its own KDF over them. They are already a uniform HKDF output.
    encryptionKey: toSqlCipherKey(keys.database),
  });

  const store = VaultStore.open({ db, device: material.deviceId });

  return {
    db,
    store,
    expenses: new ExpenseRepository(store),
    debts: new DebtRepository(store),
    documents: new DocumentRepository(store),
    notes: new NoteRepository(store),
    accounts: new AccountRepository(store),
    keys,
    dataKey: material.dataKey,
    deviceId: material.deviceId,
    slot: material.slot,
  };
}

/**
 * Categories to start with, so the first launch is usable rather than an empty
 * screen demanding setup before a single coffee can be logged.
 */
export const STARTER_CATEGORIES = [
  { id: 'cat_food', name: 'Food', icon: '🍽️', color: '#E8590C' },
  { id: 'cat_transport', name: 'Transport', icon: '🚕', color: '#1971C2' },
  { id: 'cat_groceries', name: 'Groceries', icon: '🛒', color: '#2F9E44' },
  { id: 'cat_subs', name: 'Subscriptions', icon: '💻', color: '#6741D9' },
  { id: 'cat_bills', name: 'Bills', icon: '🧾', color: '#C2255C' },
  { id: 'cat_other', name: 'Other', icon: '•', color: '#495057' },
] as const;

export function seedCategories(vault: OpenVault): void {
  if (vault.expenses.listCategories().length > 0) return;

  STARTER_CATEGORIES.forEach((category, index) => {
    vault.expenses.addCategory({
      id: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      sortOrder: index,
    });
  });
}
