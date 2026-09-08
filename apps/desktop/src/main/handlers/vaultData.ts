/**
 * Search, categories, and backup.
 *
 * The backup is the whole vault in the clear. That is core's deliberate choice —
 * it does not assume where the file is going — which makes it this layer's job
 * to say so before writing one, and to write it only where the user pointed.
 */

import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';

import {
  backupFilename,
  exportBackup,
  parseAmount,
  parseBackup,
  restoreBackup,
  searchEverything,
  serializeBackup,
} from '@vaultp/core';

import type { CategoryFormDto, SearchResultDto } from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toOptionalMoneyDto } from './serialize.js';

export function registerVaultDataHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('search:everything', (_event, term: string): SearchResultDto[] =>
    searchEverything(requireVault().store.database, term).map((result) => ({
      kind: result.kind,
      id: result.id,
      title: result.title,
      detail: result.detail,
      amount: toOptionalMoneyDto(result.amount),
      date: result.date,
    })),
  );

  ipcMain.handle('categories:add', (_event, form: CategoryFormDto) => {
    const expenses = requireVault().expenses;
    const limit = form.monthlyLimit.trim();

    const created = expenses.addCategory({
      name: form.name,
      rollover: form.rollover,
      // No limit at all, rather than a limit of zero: a category with a zero
      // ceiling would report every expense as an overspend.
      ...(limit ? { monthlyLimit: parseAmount(limit, expenses.baseCurrency) } : {}),
    });
    return { id: created.id };
  });

  ipcMain.handle('categories:archive', (_event, id: string) => {
    // Archived, never deleted: past expenses must keep a readable category.
    requireVault().expenses.archiveCategory(id);
  });

  ipcMain.handle('backup:export', async () => {
    const vault = requireVault();
    const picked = await dialog.showSaveDialog({
      title: 'Export the vault — this file is NOT encrypted',
      defaultPath: backupFilename(),
      filters: [{ name: 'VaultP backup', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return undefined;

    await writeFile(picked.filePath, serializeBackup(exportBackup(vault.store)), 'utf8');
    return picked.filePath;
  });

  ipcMain.handle('backup:restore', async () => {
    const vault = requireVault();
    const picked = await dialog.showOpenDialog({
      title: 'Restore from a backup',
      properties: ['openFile'],
      filters: [{ name: 'VaultP backup', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return undefined;

    // A merge, not a replace, and safe to run twice: events carry their own
    // ordering, so nothing already in this vault is lost.
    return restoreBackup(vault.store, parseBackup(await readFile(picked.filePaths[0], 'utf8')));
  });
}
