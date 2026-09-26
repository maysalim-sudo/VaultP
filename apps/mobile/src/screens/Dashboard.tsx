/**
 * The month at a glance.
 *
 * Three questions, in the order they matter:
 *
 *   Where is this month heading?      forecast, split into certain and estimated
 *   Which category is in trouble?     budgets, only for categories with a limit
 *   When does the card stop working?  the annual foreign-currency ceiling
 *
 * The third is last on the screen but is the one with a hard consequence: when
 * that allowance runs out, foreign payments are declined and subscriptions lapse.
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import {
  BASE_CURRENCY,
  budgetForMonth,
  exponentOf,
  forecastAllowance,
  forecastMonth,
  formatMoney,
  isAllowanceConfigured,
  loadAllowanceConfig,
  monthKey,
  money,
  saveAllowanceConfig,
  todayIn,
  toDecimalString,
  type CategoryBudget,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { BackupScreen } from './BackupScreen.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

export function Dashboard({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [editingLimit, setEditingLimit] = useState<CategoryBudget | null>(null);
  const [editingCeiling, setEditingCeiling] = useState(false);
  const [showingBackup, setShowingBackup] = useState(false);

  const forecast = useMemo(
    () => forecastMonth(vault.expenses, vault.db, today),
    [vault, version, today],
  );

  const budgets = useMemo(
    () => budgetForMonth(vault.expenses, vault.db, monthKey(today)),
    [vault, version, today],
  );

  const allowanceConfig = useMemo(
    () => loadAllowanceConfig(vault.store),
    [vault, version],
  );

  const allowance = useMemo(
    () =>
      isAllowanceConfigured(allowanceConfig)
        ? forecastAllowance(vault.db, allowanceConfig, today)
        : null,
    [vault, version, allowanceConfig, today],
  );

  const withLimits = budgets.filter((budget) => budget.limit !== null);
  const withoutLimits = budgets.filter((budget) => budget.limit === null);

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.dim }]}>Close</Text>
            </Pressable>
          ) : (
            // Keeps the title centred in a three-slot header when there is
            // nothing to close: this screen is the page, not a layer over one.
            <View />
          )}
          <Text style={[styles.headerTitle, { color: palette.text }]}>
            {monthKey(today)}
          </Text>
          <Pressable onPress={() => setShowingBackup(true)} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>Backup</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* ---------------------------------------------------- forecast */}
          <Section title="Heading for" palette={palette}>
            <Text style={[styles.big, { color: palette.text }]}>
              {formatMoney(forecast.projectedTotal, 'fr-TN')}
            </Text>
            <Text style={[styles.caption, { color: palette.dim }]}>
              {toDecimalString(forecast.spentSoFar.total)} spent
              {forecast.committed.amountMinor > 0
                ? ` · ${toDecimalString(forecast.committed)} already committed`
                : ''}
              {forecast.variable.amountMinor > 0
                ? ` · ${toDecimalString(forecast.variable)} projected`
                : ''}
            </Text>
            <Text style={[styles.caption, { color: palette.dim }]}>
              {forecast.daysRemaining} day{forecast.daysRemaining === 1 ? '' : 's'} left
            </Text>

            {forecast.variable.amountMinor > 0 ? (
              // Show the basis, not just the conclusion. A projection built from
              // one day of entries and one built from three weeks look identical
              // as a number, and are worth very different amounts of trust.
              <Note palette={palette} tone={forecast.variableUnreliable ? 'warning' : 'dim'}>
                Projected from {toDecimalString(forecast.dailyAverage)} a day across{' '}
                {forecast.daysWithSpending} day
                {forecast.daysWithSpending === 1 ? '' : 's'} of spending.
                {forecast.variableUnreliable
                  ? ' Too few to mean much yet — treat it as a hint.'
                  : ''}
              </Note>
            ) : null}

            {forecast.rulesWithoutRate.length > 0 ? (
              <Note palette={palette} tone="warning">
                {forecast.rulesWithoutRate.length} subscription
                {forecast.rulesWithoutRate.length === 1 ? '' : 's'} could not be
                valued in {BASE_CURRENCY} yet, so this total is a floor.
              </Note>
            ) : null}

            {forecast.spentSoFar.unvaluedCount > 0 ? (
              <Note palette={palette} tone="warning">
                {forecast.spentSoFar.unvaluedCount} charge
                {forecast.spentSoFar.unvaluedCount === 1 ? '' : 's'} still waiting on a
                statement, and not counted above.
              </Note>
            ) : null}
          </Section>

          {/* ----------------------------------------------------- budgets */}
          <Section title="Budgets" palette={palette}>
            {withLimits.length === 0 ? (
              <Text style={[styles.caption, { color: palette.dim }]}>
                No limits set. Tap a category below to give it one.
              </Text>
            ) : null}

            {withLimits.map((budget) => (
              <BudgetRow
                key={budget.category.id}
                budget={budget}
                palette={palette}
                onPress={() => setEditingLimit(budget)}
              />
            ))}

            {withoutLimits.length > 0 ? (
              <View style={styles.chips}>
                {withoutLimits.map((budget) => (
                  <Pressable
                    key={budget.category.id}
                    onPress={() => setEditingLimit(budget)}
                    style={[
                      styles.chip,
                      { borderColor: palette.border, backgroundColor: palette.surface },
                    ]}
                  >
                    <Text style={{ color: palette.text }}>
                      {budget.category.icon ?? ''} {budget.category.name}
                      {budget.spend.total.amountMinor > 0
                        ? `  ${toDecimalString(budget.spend.total)}`
                        : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Section>

          {/* --------------------------------------------------- allowance */}
          <Section title="Foreign currency allowance" palette={palette}>
            {allowance ? (
              <>
                <Text style={[styles.big, { color: palette.text }]}>
                  {formatMoney(allowance.remaining, 'fr-TN')}
                </Text>
                <Text style={[styles.caption, { color: palette.dim }]}>
                  left of {toDecimalString(allowance.ceiling)} for {allowance.period.label}
                </Text>

                <Meter
                  ratio={allowance.ratioUsed}
                  palette={palette}
                  colour={allowance.ratioUsed > 0.9 ? palette.negative : palette.accent}
                />

                {allowance.exhaustionDate ? (
                  <Note palette={palette} tone="warning">
                    At this rate the ceiling runs out on {allowance.exhaustionDate}.
                    After that, foreign payments start being declined.
                  </Note>
                ) : (
                  <Note palette={palette} tone="dim">
                    Committed subscriptions take it to{' '}
                    {toDecimalString(allowance.projectedTotal)} by the end of the period.
                  </Note>
                )}

                {allowance.rulesWithoutRate.length > 0 ? (
                  <Note palette={palette} tone="warning">
                    {allowance.rulesWithoutRate.length} subscription
                    {allowance.rulesWithoutRate.length === 1 ? '' : 's'} not yet valued,
                    so the projection is a floor.
                  </Note>
                ) : null}

                <Pressable onPress={() => setEditingCeiling(true)} style={styles.link}>
                  <Text style={{ color: palette.accent, fontWeight: '600' }}>
                    Change the ceiling
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.caption, { color: palette.dim }]}>
                  Tunisian cards carry a yearly ceiling on international payments. Set
                  yours and the app will track what is left and warn before it runs out.
                </Text>
                <Pressable onPress={() => setEditingCeiling(true)} style={styles.link}>
                  <Text style={{ color: palette.accent, fontWeight: '600' }}>
                    Set the ceiling
                  </Text>
                </Pressable>
              </>
            )}
          </Section>
        </ScrollView>

        {editingLimit ? (
          <AmountSheet
            title={`${editingLimit.category.name} · monthly limit`}
            hint="Zero removes the limit."
            initialMinor={editingLimit.limit?.amountMinor ?? 0}
            onCancel={() => setEditingLimit(null)}
            onSave={(minor) => {
              mutate((v) =>
                v.expenses.addCategory({
                  id: editingLimit.category.id,
                  name: editingLimit.category.name,
                  sortOrder: editingLimit.category.sortOrder,
                  ...(editingLimit.category.icon ? { icon: editingLimit.category.icon } : {}),
                  ...(editingLimit.category.color ? { color: editingLimit.category.color } : {}),
                  ...(minor > 0 ? { monthlyLimit: money(minor, BASE_CURRENCY) } : {}),
                }),
              );
              setEditingLimit(null);
            }}
          />
        ) : null}

        {showingBackup ? (
          <BackupScreen onClose={() => setShowingBackup(false)} />
        ) : null}

        {editingCeiling ? (
          <AmountSheet
            title="Annual foreign-currency ceiling"
            hint="What your card allows for international payments in a year."
            initialMinor={allowanceConfig.ceilingMinor}
            onCancel={() => setEditingCeiling(false)}
            onSave={(minor) => {
              mutate((v) =>
                saveAllowanceConfig(v.store, {
                  ...allowanceConfig,
                  ceilingMinor: minor,
                  currency: BASE_CURRENCY,
                }),
              );
              setEditingCeiling(false);
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function Section({
  title,
  palette,
  children,
}: {
  title: string;
  palette: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.dim }]}>{title}</Text>
      {children}
    </View>
  );
}

function Note({
  palette,
  tone,
  children,
}: {
  palette: Palette;
  // No 'danger' tone: a money note is never red, however close the ceiling is.
  tone: 'dim' | 'warning';
  children: React.ReactNode;
}) {
  const colour = tone === 'warning' ? palette.warning : palette.dim;
  return <Text style={[styles.note, { color: colour }]}>{children}</Text>;
}

function Meter({
  ratio,
  palette,
  colour,
}: {
  ratio: number;
  palette: Palette;
  colour: string;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.meter, { backgroundColor: palette.key }]}>
      <View
        style={[styles.meterFill, { width: `${clamped * 100}%`, backgroundColor: colour }]}
      />
    </View>
  );
}

function BudgetRow({
  budget,
  palette,
  onPress,
}: {
  budget: CategoryBudget;
  palette: Palette;
  onPress: () => void;
}) {
  const colour = budget.overspent
    ? palette.negative
    : (budget.ratioUsed ?? 0) > 0.85
      ? palette.warning
      : (budget.category.color ?? palette.accent);

  return (
    <Pressable onPress={onPress} style={styles.budgetRow}>
      <View style={styles.budgetHeader}>
        <Text style={[styles.budgetName, { color: palette.text }]} numberOfLines={1}>
          {budget.category.icon ?? ''} {budget.category.name}
        </Text>
        <Text style={[styles.budgetNumbers, { color: budget.overspent ? palette.negative : palette.dim }]}>
          {toDecimalString(budget.spend.total)} / {toDecimalString(budget.available!)}
        </Text>
      </View>
      <Meter ratio={budget.ratioUsed ?? 0} palette={palette} colour={colour} />
      {budget.carriedIn.amountMinor > 0 ? (
        <Text style={[styles.note, { color: palette.dim }]}>
          includes {toDecimalString(budget.carriedIn)} carried over
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 52 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  headerTitle: { fontWeight: '700', fontSize: 16, flexShrink: 1, textAlign: 'center' },
  headerAction: { fontSize: 16, fontWeight: '600' },
  headerSpacer: { width: 48 },

  body: { paddingHorizontal: 20, paddingBottom: 48 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  big: { fontSize: 34, fontWeight: '700' },
  caption: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  note: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  link: { paddingVertical: 12 },

  meter: { height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 10 },
  meterFill: { height: '100%', borderRadius: 999 },

  budgetRow: { paddingVertical: 12 },
  budgetHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  budgetName: { fontWeight: '600', flexShrink: 1 },
  budgetNumbers: { fontSize: 13 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16 },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
});
