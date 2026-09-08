/**
 * Recurring rules, and the charges they imply.
 *
 * Auto-logging is run on demand rather than on a timer. The ids are
 * deterministic — `auto:<ruleId>:<date>` — so running it twice, or running it
 * here after the phone already did, converges on one row rather than two.
 */

import { ipcMain } from 'electron';

import {
  detectPriceChanges,
  money,
  parseAmount,
  pendingReminders,
  runAutoLog,
  todayIn,
  upcomingCharges,
  type RecurringRule,
} from '@vaultp/core';

import type { DueChargeDto, RuleDto, RuleFormDto } from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toMoneyDto } from './serialize.js';

export function registerRuleHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('rules:list', (): RuleDto[] => {
    const vault = requireVault();
    const changes = new Map(
      detectPriceChanges(vault.expenses).map((change) => [change.rule.id, change]),
    );

    return vault.expenses.listRules().map((rule: RecurringRule): RuleDto => {
      const change = changes.get(rule.id);
      return {
        id: rule.id,
        name: rule.name,
        amount: toMoneyDto(rule.amount),
        categoryId: rule.categoryId,
        frequency: rule.frequency,
        intervalN: rule.intervalN,
        anchorDate: rule.anchorDate,
        autoLog: rule.autoLog,
        state: rule.state,
        priceChange: change
          ? {
              difference: toMoneyDto(money(change.differenceMinor, rule.amount.currency)),
              ratio: change.ratio,
            }
          : null,
      };
    });
  });

  ipcMain.handle('rules:add', (_event, form: RuleFormDto) => {
    const created = requireVault().expenses.addRule({
      name: form.name.trim(),
      amount: parseAmount(form.amount, form.currency),
      frequency: form.frequency,
      // The rule records the day it was created, and core will not invent
      // occurrences before it. A rule added on the 7th anchored to the 1st
      // describes what happens next month, not a charge that already happened.
      anchorDate: form.anchorDate || todayIn(),
      intervalN: form.intervalN,
      autoLog: form.autoLog,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    });
    return { id: created.id };
  });

  ipcMain.handle('rules:setState', (_event, id: string, state: 'active' | 'paused' | 'ended') => {
    requireVault().expenses.setRuleState(id, state);
  });

  ipcMain.handle('rules:updateAmount', (_event, id: string, amount: string, currency: string) => {
    requireVault().expenses.updateRuleAmount(id, parseAmount(amount, currency));
  });

  ipcMain.handle('rules:runAutoLog', () => ({
    created: runAutoLog(requireVault().expenses, todayIn()).length,
  }));

  ipcMain.handle('rules:pending', (): DueChargeDto[] =>
    pendingReminders(requireVault().expenses, todayIn()).map((occurrence) => ({
      ruleId: occurrence.rule.id,
      name: occurrence.rule.name,
      date: occurrence.date,
      amount: toMoneyDto(occurrence.rule.amount),
    })),
  );

  ipcMain.handle('rules:upcoming', (): DueChargeDto[] =>
    upcomingCharges(requireVault().expenses, todayIn()).map((charge) => ({
      ruleId: charge.rule.id,
      name: charge.rule.name,
      date: charge.date,
      amount: toMoneyDto(charge.rule.amount),
    })),
  );
}
