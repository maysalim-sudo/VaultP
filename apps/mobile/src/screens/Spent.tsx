/**
 * What was spent: the first part of Money.
 *
 * The month leads, with its budgets as segmented meters and where it is heading.
 * Below it, every charge grouped under its day's number, each one tappable,
 * because a mistake is easiest to fix while you still remember making it.
 *
 * Foreign charges keep their three states apart: a real debited figure, an
 * estimate marked with ≈, or "awaiting statement" with no number in dinars. An
 * unknown amount never hides inside a total.
 *
 * The annual allowance sits here too. It is last on the page but it is the one
 * with a hard consequence: when it runs out, foreign payments are declined.
 */

import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  budgetForMonth,
  type Category,
  type CategoryBudget,
  type Expense,
  forecastAllowance,
  forecastMonth,
  formatAmount,
  formatAmountParts,
  isAllowanceConfigured,
  loadAllowanceConfig,
  money,
  monthKey,
  monthTotal,
  saveAllowanceConfig,
  addDays,
  todayIn,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import { Cells, Disc, Empty, Figure, Label, Pill, Row, Tile } from '../components/Industrial.js';
import { categoryIcon } from '../components/icons.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
import { YearGauge } from '../components/YearGauge.js';
import { useOpenVault } from '../vault/VaultContext.js';

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "TODAY · FRI", "YESTERDAY · THU", or "WED · SEP": the label beside a day's number. */
function dayLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(y, m - 1, d, 12).getDay()]!;
  if (date === today) return `TODAY · ${weekday}`;
  if (date === addDays(today, -1)) return `YESTERDAY · ${weekday}`;
  return `${weekday} · ${MONTHS[m - 1]!.slice(0, 3)}${y === Number(today.slice(0, 4)) ? '' : ` ${y}`}`;
}

/** The day's total in dinars; "≈" when an estimate is in it, "+ ?" when a value is missing. */
function dayTotal(expenses: readonly Expense[]): string {
  let minor = 0;
  let estimated = false;
  let unknown = false;
  for (const expense of expenses) {
    if (expense.base?.currency === BASE_CURRENCY) {
      minor += expense.base.amountMinor;
      estimated ||= expense.baseEstimated;
    } else {
      unknown = true;
    }
  }
  return `${formatAmount(money(minor, BASE_CURRENCY), { estimated })}${unknown ? ' + ?' : ''}`;
}

export function Spent({ onEditExpense }: { onEditExpense: (expense: Expense) => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [filter, setFilter] = useState<string | null>(null);
  const [editingLimit, setEditingLimit] = useState<CategoryBudget | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingCeiling, setEditingCeiling] = useState(false);
  const [settingBudgets, setSettingBudgets] = useState(false);

  const month = useMemo(() => monthTotal(vault.db, monthKey(today), BASE_CURRENCY), [vault, version, today]);
  const forecast = useMemo(() => forecastMonth(vault.expenses, vault.db, today), [vault, version, today]);
  const budgets = useMemo(() => budgetForMonth(vault.expenses, vault.db, monthKey(today)), [vault, version, today]);
  const allowanceConfig = useMemo(() => loadAllowanceConfig(vault.store), [vault, version]);
  const allowance = useMemo(
    () => (isAllowanceConfigured(allowanceConfig) ? forecastAllowance(vault.db, allowanceConfig, today) : null),
    [vault, version, allowanceConfig, today],
  );

  const categories = useMemo(() => vault.expenses.listCategories(true), [vault, version]);
  const nameOf = (id: string | null) => categories.find((category) => category.id === id)?.name ?? 'Uncategorised';

  const days = useMemo(() => {
    const groups: { date: string; expenses: Expense[] }[] = [];
    for (const expense of vault.expenses.listExpenses({ limit: 200, ...(filter ? { categoryId: filter } : {}) })) {
      const last = groups[groups.length - 1];
      if (last?.date === expense.occurredOn) last.expenses.push(expense);
      else groups.push({ date: expense.occurredOn, expenses: [expense] });
    }
    return groups;
  }, [vault, version, filter]);

  const withLimits = budgets.filter((budget) => budget.limit !== null);
  const withoutLimits = budgets.filter((budget) => budget.limit === null);
  const hero = formatAmountParts(month.total);
  const heading = formatAmountParts(forecast.projectedTotal, { estimated: true });

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Tile palette={palette}>
          <Label palette={palette}>
            {MONTHS[Number(today.slice(5, 7)) - 1]} · {month.transactionCount} CHARGE{month.transactionCount === 1 ? '' : 'S'}
          </Label>
          <Figure value={hero.figure} unit={hero.unit} size={52} palette={palette} />
          {month.unvaluedCount > 0 ? (
            <Text style={[styles.note, { color: palette.estimate }]}>
              + {month.unvaluedCount} foreign charge{month.unvaluedCount === 1 ? '' : 's'} not valued yet
            </Text>
          ) : null}

          <View style={[styles.heading, { borderTopColor: palette.border }]}>
            <Label palette={palette}>HEADING FOR · {forecast.daysRemaining} DAYS LEFT</Label>
            <Text style={[styles.headingFigure, { color: palette.estimate }]}>{heading.text}</Text>
            {forecast.variable.amountMinor > 0 ? (
              // Show the basis, not just the conclusion: a projection from one day
              // of entries and one from three weeks look identical as a number.
              <Text style={[styles.note, { color: forecast.variableUnreliable ? palette.accentText : palette.dim }]}>
                {formatAmount(forecast.dailyAverage)} a day across {forecast.daysWithSpending} day
                {forecast.daysWithSpending === 1 ? '' : 's'} of spending
                {forecast.variableUnreliable ? '. Too few to mean much yet: a rough hint.' : ''}
              </Text>
            ) : null}
            {forecast.rulesWithoutRate.length > 0 ? (
              <Text style={[styles.note, { color: palette.accentText }]}>
                {forecast.rulesWithoutRate.length} repeating charge{forecast.rulesWithoutRate.length === 1 ? '' : 's'} with no
                known rate, so this is a floor.
              </Text>
            ) : null}
          </View>

          {withLimits.length > 0 ? (
            <View style={styles.budgets}>
              {withLimits.map((budget) => (
                <BudgetRow
                  key={budget.category.id}
                  budget={budget}
                  palette={palette}
                  onPress={() => setEditingLimit(budget)}
                  onLongPress={() => setEditingCategory(budget.category)}
                />
              ))}
            </View>
          ) : null}

          {settingBudgets ? (
            <View style={styles.wrap}>
              {withoutLimits.map((budget) => (
                <Pill
                  key={budget.category.id}
                  label={budget.category.name}
                  palette={palette}
                  onPress={() => setEditingLimit(budget)}
                  onLongPress={() => setEditingCategory(budget.category)}
                />
              ))}
            </View>
          ) : null}
          {withoutLimits.length > 0 ? (
            <Pressable onPress={() => setSettingBudgets((current) => !current)} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: palette.accentText }]}>{settingBudgets ? 'Done' : 'Set a budget'}</Text>
            </Pressable>
          ) : null}
          {settingBudgets || withLimits.length > 0 ? (
            <Text style={[styles.note, { color: palette.textFaint }]}>
              Tap a category for its budget; hold it to rename or archive.
            </Text>
          ) : null}
        </Tile>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pill label="All" selected={filter === null} palette={palette} onPress={() => setFilter(null)} />
          {categories
            .filter((category) => !category.archived)
            .map((category) => (
              <Pill
                key={category.id}
                label={category.name}
                selected={filter === category.id}
                palette={palette}
                onPress={() => setFilter(category.id)}
              />
            ))}
        </ScrollView>

        {days.length === 0 ? (
          <Empty palette={palette}>{filter ? 'NOTHING IN THIS CATEGORY' : 'NOTHING SPENT YET'}</Empty>
        ) : null}

        {days.map((day) => (
          <View key={day.date} style={[styles.day, { backgroundColor: palette.surface }]}>
            <View style={styles.dayHead}>
              <Text style={[styles.dayNumber, { color: palette.text }]}>{day.date.slice(8, 10)}</Text>
              <Label palette={palette}>{dayLabel(day.date, today)}</Label>
              <Text style={[styles.dayTotal, { color: palette.dim }]} numberOfLines={1}>
                {dayTotal(day.expenses)}
              </Text>
            </View>
            {day.expenses.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                category={nameOf(expense.categoryId)}
                palette={palette}
                onPress={() => onEditExpense(expense)}
              />
            ))}
          </View>
        ))}

        <Tile palette={palette}>
          <Label palette={palette}>FOREIGN CURRENCY ALLOWANCE</Label>
          {allowance ? (
            <YearGauge allowance={allowance} today={today} palette={palette} />
          ) : (
            <Text style={[styles.note, { color: palette.dim }]}>
              Tunisian cards carry a yearly ceiling on international payments. Set yours and the app tracks what is left,
              and warns before it runs out.
            </Text>
          )}
          <Pressable onPress={() => setEditingCeiling(true)} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.link, { color: palette.accentText }]}>
              {allowance ? 'Change the ceiling' : 'Set the ceiling'}
            </Text>
          </Pressable>
        </Tile>
      </ScrollView>

      {editingLimit ? (
        <AmountSheet
          title={`${editingLimit.category.name} · monthly limit`}
          hint="Zero removes the limit."
          initialMinor={editingLimit.limit?.amountMinor ?? 0}
          onCancel={() => setEditingLimit(null)}
          onSave={(minor) => {
            // Only the limit changes: carry-over and everything else stay.
            mutate((v) =>
              v.expenses.updateCategory(editingLimit.category.id, {
                monthlyLimit: minor > 0 ? money(minor, BASE_CURRENCY) : null,
              }),
            );
            setEditingLimit(null);
          }}
        />
      ) : null}

      {editingCategory ? (
        <FieldsSheet
          title="Edit category"
          palette={palette}
          fields={[{ key: 'name', label: 'Name', initial: editingCategory.name, required: true }]}
          footnote="Archiving hides it from new expenses. Past expenses keep it, so nothing loses its heading."
          actions={[
            {
              label: 'Archive',
              destructive: true,
              onPress: () => {
                const id = editingCategory.id;
                setEditingCategory(null);
                mutate((v) => v.expenses.archiveCategory(id));
              },
            },
          ]}
          onCancel={() => setEditingCategory(null)}
          onSave={(values) => {
            const id = editingCategory.id;
            setEditingCategory(null);
            try {
              mutate((v) => v.expenses.updateCategory(id, { name: values.name ?? '' }));
            } catch (caught: unknown) {
              Alert.alert('Not renamed', caught instanceof Error ? caught.message : String(caught));
            }
          }}
        />
      ) : null}

      {editingCeiling ? (
        <AmountSheet
          title="Annual foreign-currency ceiling"
          hint="What your card allows for international payments in a year."
          initialMinor={allowanceConfig.ceilingMinor}
          onCancel={() => setEditingCeiling(false)}
          onSave={(minor) => {
            mutate((v) => saveAllowanceConfig(v.store, { ...allowanceConfig, ceilingMinor: minor, currency: BASE_CURRENCY }));
            setEditingCeiling(false);
          }}
        />
      ) : null}
    </View>
  );
}

function BudgetRow({
  budget,
  palette,
  onPress,
  onLongPress,
}: {
  budget: CategoryBudget;
  palette: Palette;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const ratio = budget.ratioUsed ?? 0;
  const over = budget.overspent || ratio >= 0.8;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" style={styles.budget}>
      <Text style={[styles.budgetName, { color: palette.dim }]} numberOfLines={1}>
        {budget.category.name}
      </Text>
      <Cells ratio={ratio} colour={over ? palette.accent : palette.text} palette={palette} />
      <Text style={[styles.budgetPercent, { color: over ? palette.accentText : palette.dim }]}>{Math.round(ratio * 100)}%</Text>
    </Pressable>
  );
}

function ExpenseRow({
  expense,
  category,
  palette,
  onPress,
}: {
  expense: Expense;
  category: string;
  palette: Palette;
  onPress: () => void;
}) {
  const foreign = expense.amount.currency !== BASE_CURRENCY;
  // The title already says the category when no merchant was typed.
  const meta = [expense.merchant ? category : null, foreign ? formatAmount(expense.amount) : null, expense.note]
    .filter(Boolean)
    .join(' · ');

  // A foreign charge is one of three things, and they must not look alike.
  const shown = !foreign
    ? { value: formatAmount(expense.amount, { unit: 'none' }), unit: BASE_CURRENCY, colour: palette.text }
    : !expense.base
      ? { value: '—', unit: 'AWAITING STATEMENT', colour: palette.estimate }
      : expense.baseEstimated
        ? { value: formatAmount(expense.base, { unit: 'none', estimated: true }), unit: `${BASE_CURRENCY} · ESTIMATE`, colour: palette.estimate }
        : { value: formatAmount(expense.base, { unit: 'none' }), unit: BASE_CURRENCY, colour: palette.text };

  return (
    <Row
      palette={palette}
      leading={<Disc icon={categoryIcon(category)} palette={palette} />}
      title={expense.merchant ?? category}
      meta={meta}
      value={shown.value}
      valueColour={shown.colour}
      unit={shown.unit}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 16, gap: 10 },

  note: { fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  link: { fontFamily: fonts.uiSemibold, fontSize: 14, paddingVertical: 4 },

  heading: { gap: 6, paddingTop: 14, borderTopWidth: 1 },
  headingFigure: { fontFamily: fonts.monoMedium, fontSize: 18 },

  budgets: { gap: 10 },
  budget: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  budgetName: { fontFamily: fonts.ui, fontSize: 12, width: 84 },
  budgetPercent: { fontFamily: fonts.mono, fontSize: 11, width: 40, textAlign: 'right' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  chips: { gap: 6, paddingHorizontal: 2 },

  day: { borderRadius: 22, paddingVertical: 6, overflow: 'hidden' },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  dayNumber: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30 },
  dayTotal: { fontFamily: fonts.mono, fontSize: 12, marginLeft: 'auto', flexShrink: 1 },
});
