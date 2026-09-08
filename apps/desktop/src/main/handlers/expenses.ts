/**
 * Expense operations.
 *
 * The amount crosses as the text that was typed, and is parsed here by core.
 * The renderer must not do it: TND has three decimal places, JPY has none, and
 * a multiplier chosen in the UI is a multiplier that is wrong for some currency.
 */

import { dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';

import {
  BASE_CURRENCY,
  expensesToCsv,
  listCurrencies,
  parseAmount,
  todayIn,
  type AddExpenseInput,
  type Category,
  type Expense,
} from '@vaultp/core';

import type {
  CategoryDto,
  CurrencyDto,
  ExpenseDto,
  ExpenseFormDto,
  ExpenseQueryDto,
} from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toMoneyDto, toOptionalMoneyDto } from './serialize.js';

export function toExpenseDto(expense: Expense): ExpenseDto {
  return {
    id: expense.id,
    occurredOn: expense.occurredOn,
    amount: toMoneyDto(expense.amount),
    base: toOptionalMoneyDto(expense.base),
    baseEstimated: expense.baseEstimated,
    merchant: expense.merchant,
    note: expense.note,
    categoryId: expense.categoryId,
  };
}

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    archived: category.archived,
    monthlyLimit: toOptionalMoneyDto(category.monthlyLimit),
    rollover: category.rollover,
  };
}

/** A blank field is "not given", never an empty string written over what was there. */
function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text === '' ? undefined : text;
}

export function registerExpenseHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('expenses:list', (_event, query: ExpenseQueryDto) =>
    requireVault()
      .expenses.listExpenses({ limit: 200, ...query })
      .map(toExpenseDto),
  );

  ipcMain.handle('expenses:categories', () =>
    requireVault().expenses.listCategories().map(toCategoryDto),
  );

  ipcMain.handle(
    'expenses:currencies',
    (): CurrencyDto[] =>
      listCurrencies().map((currency) => ({ code: currency.code, name: currency.name })),
  );

  ipcMain.handle('expenses:add', (_event, form: ExpenseFormDto) => {
    const charged = trimmed(form.charged);
    const merchant = trimmed(form.merchant);
    const note = trimmed(form.note);

    const input: AddExpenseInput = {
      occurredOn: form.occurredOn || todayIn(),
      amount: parseAmount(form.amount, form.currency),
      ...(charged ? { charged: parseAmount(charged, BASE_CURRENCY) } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(merchant ? { merchant } : {}),
      ...(note ? { note } : {}),
    };

    return { id: requireVault().expenses.addExpense(input).id };
  });

  /**
   * Save an edited expense.
   *
   * The amount is only put in the patch when it actually changed. Core re-derives
   * the base-currency value whenever an amount is passed, so submitting an
   * unchanged amount alongside a corrected merchant would throw away a real
   * debited figure and replace it with an estimate — a fact quietly demoted to
   * a guess by an edit that had nothing to do with money.
   */
  ipcMain.handle('expenses:update', (_event, id: string, form: ExpenseFormDto) => {
    const vault = requireVault();
    const existing = vault.expenses.getExpense(id);
    if (!existing) throw new Error('That expense is no longer in the vault.');

    const amount = parseAmount(form.amount, form.currency);
    const charged = trimmed(form.charged);
    const amountChanged =
      amount.amountMinor !== existing.amount.amountMinor ||
      amount.currency !== existing.amount.currency;
    const chargedChanged =
      charged !== undefined &&
      parseAmount(charged, BASE_CURRENCY).amountMinor !== existing.base?.amountMinor;

    vault.expenses.updateExpense(id, {
      occurredOn: form.occurredOn,
      categoryId: form.categoryId,
      merchant: trimmed(form.merchant) ?? '',
      note: trimmed(form.note) ?? '',
      ...(amountChanged ? { amount } : {}),
      ...(chargedChanged && charged ? { charged: parseAmount(charged, BASE_CURRENCY) } : {}),
    });

    return { id };
  });

  ipcMain.handle('expenses:delete', (_event, id: string) => {
    requireVault().expenses.deleteExpense(id);
  });

  ipcMain.handle('expenses:unsettled', () =>
    requireVault().expenses.listUnsettled().map(toExpenseDto),
  );

  ipcMain.handle('expenses:settle', (_event, id: string, charged: string) => {
    requireVault().expenses.settleExpense(id, parseAmount(charged, BASE_CURRENCY));
    return { id };
  });

  ipcMain.handle('expenses:exportCsv', async () => {
    const vault = requireVault();
    const picked = await dialog.showSaveDialog({
      title: 'Export expenses',
      defaultPath: `vaultp-expenses-${todayIn()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (picked.canceled || !picked.filePath) return undefined;

    const csv = expensesToCsv(vault.expenses.listExpenses({ limit: 100_000 }), {
      baseCurrency: BASE_CURRENCY,
      categories: vault.expenses.listCategories(true),
    });
    // A BOM, because this is opened in Excel and a merchant with an accent in it
    // otherwise arrives mangled.
    await writeFile(picked.filePath, `﻿${csv}`, 'utf8');
    return picked.filePath;
  });
}
