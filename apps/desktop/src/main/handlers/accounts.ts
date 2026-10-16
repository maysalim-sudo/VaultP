/**
 * Accounts: balances as the person last read them.
 *
 * The balance crosses as typed text and is parsed here, by core, for the same
 * reason as an expense's amount — how many decimals a currency has is not the
 * window's business.
 */

import { ipcMain } from 'electron';

import { parseAmount, type Account, type AccountKind } from '@vaultp/core';

import type { AccountDto, AccountFormDto, AccountsDto } from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toMoneyDto } from './serialize.js';

function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    balance: toMoneyDto(account.balance),
    balanceOn: account.balanceOn,
    note: account.note,
    archived: account.archived,
  };
}

export function registerAccountHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('accounts:list', (_event, includeArchived: boolean): AccountsDto => {
    const accounts = requireVault().accounts;
    return {
      accounts: accounts.listAccounts(includeArchived === true).map(toAccountDto),
      totals: accounts.totals().map(toMoneyDto),
    };
  });

  ipcMain.handle('accounts:add', (_event, form: AccountFormDto) => {
    const created = requireVault().accounts.addAccount({
      name: form.name,
      kind: form.kind as AccountKind,
      balance: parseAmount(form.balance.trim() || '0', form.currency),
      ...(form.balanceOn ? { balanceOn: form.balanceOn } : {}),
      ...(form.note.trim() ? { note: form.note } : {}),
    });
    return { id: created.id };
  });

  /**
   * Only a balance that actually changed is re-dated: renaming an account must
   * not make a month-old figure look like it was read today.
   */
  ipcMain.handle('accounts:update', (_event, id: string, form: AccountFormDto) => {
    const accounts = requireVault().accounts;
    const existing = accounts.getAccount(id);
    if (!existing) throw new Error('That account is no longer in the vault.');

    const balance = parseAmount(form.balance.trim() || '0', form.currency);
    const balanceChanged =
      balance.amountMinor !== existing.balance.amountMinor || balance.currency !== existing.balance.currency;
    const dateChanged = form.balanceOn !== '' && form.balanceOn !== existing.balanceOn;

    accounts.updateAccount(id, {
      name: form.name,
      kind: form.kind as AccountKind,
      note: form.note,
      ...(balanceChanged ? { balance } : {}),
      ...(dateChanged ? { balanceOn: form.balanceOn } : {}),
    });
  });

  ipcMain.handle('accounts:setArchived', (_event, id: string, archived: boolean) => {
    const accounts = requireVault().accounts;
    if (archived) accounts.archiveAccount(id);
    else accounts.unarchiveAccount(id);
  });

  ipcMain.handle('accounts:delete', (_event, id: string) => {
    requireVault().accounts.deleteAccount(id);
  });
}
