/**
 * The two figures the redesigned screens lead with: how much of a debt has come
 * back, and whether the vault has been backed up lately.
 */

import { describe, expect, it } from 'vitest';

import { backupCoverage, loadBackupHistory, recordBackup } from './backupHistory.js';
import { DebtRepository } from './debts/repository.js';
import { repaymentProgress } from './debts/progress.js';
import { VaultStore } from './db/store.js';
import { openTestDatabase } from './db/testing/nodeSqlite.js';
import { parseAmount } from './money/money.js';

const tnd = (value: string) => parseAmount(value, 'TND');

function newVault() {
  const store = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
  return { store, debts: new DebtRepository(store) };
}

describe('repayment progress', () => {
  it('shows how much of what was lent has come back', () => {
    const { debts } = newVault();
    const sami = debts.addPerson({ name: 'Sami' });
    debts.lend({ personId: sami.id, amount: tnd('200.000'), occurredOn: '2026-08-01' });
    debts.recordRepaymentToMe({ personId: sami.id, amount: tnd('50.000'), occurredOn: '2026-09-01' });
    debts.recordRepaymentToMe({ personId: sami.id, amount: tnd('65.000'), occurredOn: '2026-09-10' });

    const progress = repaymentProgress(debts.ledgerFor(sami.id, '2026-09-20')!);

    expect(progress).toMatchObject({
      direction: 'owed_to_me',
      lentMinor: 200_000,
      repaidMinor: 115_000,
    });
    expect(progress!.ratio).toBeCloseTo(0.575);
  });

  it('follows the side that is winning when money went both ways', () => {
    const { debts } = newVault();
    const ines = debts.addPerson({ name: 'Ines' });
    debts.borrow({ personId: ines.id, amount: tnd('100.000'), occurredOn: '2026-08-01' });
    debts.recordRepaymentByMe({ personId: ines.id, amount: tnd('40.000'), occurredOn: '2026-09-01' });

    expect(repaymentProgress(debts.ledgerFor(ines.id, '2026-09-20')!)).toMatchObject({
      direction: 'owed_by_me',
      lentMinor: 100_000,
      repaidMinor: 40_000,
    });
  });

  it('has nothing to show once settled', () => {
    const { debts } = newVault();
    const ali = debts.addPerson({ name: 'Ali' });
    debts.lend({ personId: ali.id, amount: tnd('30.000'), occurredOn: '2026-08-01' });
    debts.settle(ali.id, '2026-09-01');

    expect(repaymentProgress(debts.ledgerFor(ali.id, '2026-09-20')!)).toBeNull();
  });
});

describe('backup history', () => {
  it('remembers backups newest first', () => {
    const { store } = newVault();
    recordBackup(store, 10, '2026-09-01T10:00:00.000Z');
    recordBackup(store, 25, '2026-09-20T10:00:00.000Z');

    expect(loadBackupHistory(store).map((b) => b.events)).toEqual([25, 10]);
  });

  it('is empty before the first backup', () => {
    expect(loadBackupHistory(newVault().store)).toEqual([]);
  });

  it('marks which of the last four weeks had a backup', () => {
    const history = [
      { at: '2026-09-26T09:00:00.000Z', events: 3 },
      { at: '2026-09-08T09:00:00.000Z', events: 2 },
    ];
    // Weeks ending 6, 13, 20 and 27 September.
    expect(backupCoverage(history, '2026-09-27')).toEqual([false, true, false, true]);
  });
});
