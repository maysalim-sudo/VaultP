/**
 * Figures for the dashboard.
 *
 * Everything here is computed by core, from the same code the phone runs. The
 * handler's only job is choosing what to show and formatting it — if a number
 * were worked out in this file, the two devices could disagree about it.
 */

import { ipcMain } from 'electron';

import {
  BASE_CURRENCY,
  forecastAllowance,
  forecastMonth,
  isAllowanceConfigured,
  loadAllowanceConfig,
  money,
  monthKey,
  monthSummary,
  parseAmount,
  pendingReminders,
  saveAllowanceConfig,
  todayIn,
  toDecimalString,
  upcomingCharges,
} from '@vaultp/core';

import type {
  AllowanceConfigDto,
  AllowanceDto,
  BudgetDto,
  DueChargeDto,
  ForecastDto,
  OverviewDto,
} from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toNoteDto } from './notes.js';
import { toMoneyDto } from './serialize.js';

export function registerOverviewHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('overview:read', (): OverviewDto => {
    const vault = requireVault();
    const today = todayIn();
    const month = monthKey(today);

    const summary = monthSummary(vault.expenses, vault.store.database, month);
    const forecast = forecastMonth(vault.expenses, vault.store.database, today);
    const allowanceConfig = loadAllowanceConfig(vault.store);
    const allowance = forecastAllowance(vault.store.database, allowanceConfig, today);

    return {
      month: {
        total: toMoneyDto(summary.spend.total),
        transactionCount: summary.spend.transactionCount,
        // Carried separately, never added in as zero: a foreign charge with no
        // statement yet is unknown, and an unknown is not nothing.
        unvaluedCount: summary.spend.unvaluedCount,
      },
      eventCount: vault.store.allEvents().length,

      forecast: {
        spentSoFar: toMoneyDto(forecast.spentSoFar.total),
        committed: toMoneyDto(forecast.committed),
        variable: toMoneyDto(forecast.variable),
        projectedTotal: toMoneyDto(forecast.projectedTotal),
        dailyAverage: toMoneyDto(forecast.dailyAverage),
        daysRemaining: forecast.daysRemaining,
        daysWithSpending: forecast.daysWithSpending,
        variableUnreliable: forecast.variableUnreliable,
        rulesWithoutRate: forecast.rulesWithoutRate.length,
      } satisfies ForecastDto,

      // Only categories with a limit: a budget row without one has nothing to
      // report against, and a list of them buries the ones that do.
      budgets: summary.budgets
        .filter((budget) => budget.limit !== null && budget.available !== null)
        .map(
          (budget): BudgetDto => ({
            categoryId: budget.category.id,
            name: budget.category.name,
            limit: toMoneyDto(budget.limit!),
            carriedIn: toMoneyDto(budget.carriedIn),
            available: toMoneyDto(budget.available!),
            spent: toMoneyDto(budget.spend.total),
            remaining: toMoneyDto(budget.remaining!),
            ratioUsed: budget.ratioUsed,
            overspent: budget.overspent,
          }),
        ),
      uncategorised: toMoneyDto(summary.uncategorised.total),

      allowance: {
        configured: isAllowanceConfigured(allowanceConfig),
        label: allowance.period.label,
        ceiling: toMoneyDto(allowance.ceiling),
        used: toMoneyDto(allowance.used),
        remaining: toMoneyDto(allowance.remaining),
        ratioUsed: allowance.ratioUsed,
        committedTotal: toMoneyDto(allowance.committedTotal),
        projectedTotal: toMoneyDto(allowance.projectedTotal),
        projectedOverrun: toMoneyDto(allowance.projectedOverrun),
        exhaustionDate: allowance.exhaustionDate,
        rulesWithoutRate: allowance.rulesWithoutRate.length,
        unvaluedCount: allowance.unvaluedCount,
        byCurrency: allowance.byCurrency.map((usage) => ({
          currency: usage.currency,
          billed: toMoneyDto(money(usage.billedMinor, usage.currency)),
          // Null, not zero, when every charge in this currency is still
          // unvalued: the sum skips them, so a 0 here would read as "cost
          // nothing" when it means "not known yet".
          charged:
            usage.unvaluedCount === usage.transactionCount
              ? null
              : toMoneyDto(money(usage.chargedMinor, allowance.ceiling.currency)),
          transactionCount: usage.transactionCount,
          unvaluedCount: usage.unvaluedCount,
        })),
      } satisfies AllowanceDto,

      upcoming: upcomingCharges(vault.expenses, today, 14).map(
        (charge): DueChargeDto => ({
          ruleId: charge.rule.id,
          name: charge.rule.name,
          date: charge.date,
          amount: toMoneyDto(charge.rule.amount),
        }),
      ),
      pendingReminders: pendingReminders(vault.expenses, today).map(
        (occurrence): DueChargeDto => ({
          ruleId: occurrence.rule.id,
          name: occurrence.rule.name,
          date: occurrence.date,
          amount: toMoneyDto(occurrence.rule.amount),
        }),
      ),

      expiringDocuments: vault.documents.expiringSoon(today).map((document) => ({
        id: document.id,
        title: document.title,
        expiryDate: document.expiryDate,
      })),

      overdueNotes: vault.notes.overdue(today).map(toNoteDto),

      openBalances: vault.debts
        .listPeople()
        .map((person) => {
          try {
            const balance = vault.debts.ledgerFor(person.id, today);
            if (!balance || balance.net.amountMinor === 0) return undefined;
            return {
              id: person.id,
              name: person.name,
              net: toMoneyDto(balance.net),
              owesYou: balance.net.amountMinor > 0,
            };
          } catch {
            return { id: person.id, name: person.name, net: null, owesYou: false };
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined),
    };
  });

  ipcMain.handle('overview:allowanceConfig', (): AllowanceConfigDto => {
    const config = loadAllowanceConfig(requireVault().store);
    return {
      ceiling: toDecimalString(money(config.ceilingMinor, config.currency)),
      currency: config.currency,
      yearStartMonth: config.yearStartMonth,
    };
  });

  ipcMain.handle('overview:saveAllowanceConfig', (_event, config: AllowanceConfigDto) => {
    const ceiling = config.ceiling.trim();
    saveAllowanceConfig(requireVault().store, {
      // A blank ceiling turns the feature off, which is what zero means here —
      // not a rule that nothing may be spent.
      ceilingMinor: ceiling === '' ? 0 : parseAmount(ceiling, config.currency).amountMinor,
      currency: config.currency || BASE_CURRENCY,
      yearStartMonth: config.yearStartMonth,
    });
  });
}
