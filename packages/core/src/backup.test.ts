import { describe, expect, it } from 'vitest';
import {
  BackupFormatError,
  backupFilename,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from './backup.js';
import { VaultStore } from './db/store.js';
import { openTestDatabase } from './db/testing/nodeSqlite.js';
import { ExpenseRepository } from './expenses/repository.js';
import { parseAmount, toDecimalString } from './money/money.js';

const tnd = (value: string) => parseAmount(value, 'TND');

function newVault(device = 'dev_phone') {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device });
  return { store, db, expenses: new ExpenseRepository(store) };
}

function populate(vault: ReturnType<typeof newVault>) {
  vault.expenses.addCategory({ id: 'food', name: 'Food', monthlyLimit: tnd('400.000') });
  vault.expenses.addExpense({
    id: 'e1',
    occurredOn: '2026-09-01',
    amount: tnd('4.500'),
    categoryId: 'food',
  });
  vault.expenses.addExpense({ id: 'e2', occurredOn: '2026-09-02', amount: tnd('12.000') });
  vault.expenses.updateExpense('e2', { amount: tnd('15.000') });
  vault.expenses.deleteExpense('e2');
}

describe('export', () => {
  it('carries every event, not just the current rows', () => {
    const vault = newVault();
    populate(vault);

    const backup = exportBackup(vault.store);

    // Five writes: category, two expenses, a correction, a deletion. Exporting
    // rows would have produced one.
    expect(backup.eventCount).toBe(5);
    expect(backup.format).toBe('vaultp-backup');
  });

  it('survives a round trip through text', () => {
    const vault = newVault();
    populate(vault);

    const reloaded = parseBackup(serializeBackup(exportBackup(vault.store)));

    expect(reloaded.events).toEqual(exportBackup(vault.store).events);
  });

  it('names the file so it sorts by date', () => {
    expect(backupFilename('2026-09-07T05:41:12.000Z')).toBe(
      'vaultp-backup-2026-09-07-05-41-12.json',
    );
  });
});

describe('restore', () => {
  it('rebuilds the vault exactly on a fresh device', () => {
    const original = newVault('dev_phone');
    populate(original);

    // As after a reinstall: new database, nothing in it.
    const restored = newVault('dev_new_phone');
    const result = restoreBackup(restored.store, exportBackup(original.store));

    expect(result.applied).toBe(result.total);
    expect(toDecimalString(restored.expenses.getExpense('e1')!.amount)).toBe('4.500');
    expect(restored.expenses.getCategory('food')?.name).toBe('Food');
  });

  it('restores history and deletions, not just what is visible', () => {
    const original = newVault();
    populate(original);

    const restored = newVault('dev_new_phone');
    restoreBackup(restored.store, exportBackup(original.store));

    // e2 was corrected then deleted: it must come back deleted, with both edits
    // still in its history.
    expect(restored.expenses.getExpense('e2')).toBeUndefined();
    expect(restored.store.historyOf('expense', 'e2')).toHaveLength(3);
  });

  it('is safe to run twice', () => {
    const original = newVault();
    populate(original);
    const backup = exportBackup(original.store);

    const restored = newVault('dev_new_phone');
    const first = restoreBackup(restored.store, backup);
    const second = restoreBackup(restored.store, backup);

    expect(first.applied).toBe(5);
    expect(second.applied).toBe(0);
    expect(restored.expenses.listExpenses()).toHaveLength(1);
  });

  it('merges rather than replaces', () => {
    const original = newVault();
    populate(original);
    const backup = exportBackup(original.store);

    // A vault that has moved on since the backup was taken.
    const current = newVault('dev_other');
    current.expenses.addExpense({
      id: 'newer',
      occurredOn: '2026-09-10',
      amount: tnd('99.000'),
    });

    restoreBackup(current.store, backup);

    // Nothing already here is lost, and what was missing is filled in.
    expect(current.expenses.getExpense('newer')).toBeDefined();
    expect(current.expenses.getExpense('e1')).toBeDefined();
  });

  it('does not resurrect data the vault deleted after the backup', () => {
    const vault = newVault();
    populate(vault);
    const backup = exportBackup(vault.store);

    vault.expenses.deleteExpense('e1');
    restoreBackup(vault.store, backup);

    // The deletion is newer than anything in the file, so it stands.
    expect(vault.expenses.getExpense('e1')).toBeUndefined();
  });
});

describe('rejecting bad files', () => {
  it('refuses something that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(BackupFormatError);
  });

  it('refuses JSON that is not a backup', () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow(/not a VaultP backup/);
  });

  it('refuses a backup from a newer app version', () => {
    // Silently ignoring unknown fields would drop data the newer version wrote.
    expect(() =>
      parseBackup(
        JSON.stringify({ format: 'vaultp-backup', version: 99, events: [] }),
      ),
    ).toThrow(/newer version/);
  });

  it('refuses a file whose events are malformed', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: 'vaultp-backup',
          version: 1,
          events: [{ id: 'x' }],
        }),
      ),
    ).toThrow();
  });
});
