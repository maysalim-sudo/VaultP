/**
 * Logging an expense.
 *
 * The one screen opened every day, so entry speed outranks everything else:
 * amount, category, done.
 *
 * Decisions that follow from that:
 *
 *   - The chosen category survives a save, so the second coffee of the week is
 *     amount then Save — two taps.
 *   - The currency defaults to TND and is out of the way, because almost every
 *     expense is local. It is one tap when it is not.
 *   - No date picker on the main path: today is right nearly every time.
 *   - Save sits under the thumb, not in a header.
 *
 * This used to be the root of the app, and carried the navigation and the month
 * figures with it. Both now live in the shell and on the home screen, which is
 * where someone looks for them; what is left here is the task.
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
  exponentOf,
  formatMoney,
  money,
  todayIn,
  toDecimalString,
  type Category,
  type Expense,
} from '@vaultp/core';

import { AmountDisplay, AmountPad } from '../components/AmountPad.js';
import { CategoryChips } from '../components/CategoryChips.js';
import {
  EMPTY_DRAFT,
  type Draft,
  draftToMinor,
  retypeForExponent,
} from '../components/amount.js';
import { paletteFor } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { ExpenseEditor } from './ExpenseEditor.js';

const CURRENCIES = [BASE_CURRENCY, 'USD', 'EUR'] as const;

/** How many past entries to show. Enough to catch a double-tap, not a history. */
const RECENT_LIMIT = 10;

export function QuickEntry() {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);

  const today = todayIn();
  const exponent = exponentOf(currency);

  const categories = useMemo<Category[]>(
    () => vault.expenses.listCategories(),
    [vault, version],
  );

  const recent = useMemo<Expense[]>(
    () => vault.expenses.listExpenses({ limit: RECENT_LIMIT }),
    [vault, version],
  );

  const todayTotal = useMemo(
    () =>
      vault.expenses
        .listExpenses({ from: today, to: today })
        .reduce((sum, expense) => sum + (expense.base?.amountMinor ?? 0), 0),
    [vault, version, today],
  );

  const amountMinor = draftToMinor(draft, exponent);
  const canSave = amountMinor > 0;

  function changeCurrency(next: string) {
    setDraft((current) => retypeForExponent(current, exponentOf(next)));
    setCurrency(next);
  }

  function save() {
    if (!canSave) return;

    const saved = mutate((v) =>
      v.expenses.addExpense({
        occurredOn: today,
        amount: money(amountMinor, currency),
        ...(categoryId ? { categoryId } : {}),
      }),
    );

    if (saved) {
      setDraft(EMPTY_DRAFT);
      setJustSaved(`${toDecimalString(saved.amount)} ${saved.amount.currency}`);
      setTimeout(() => setJustSaved(null), 1600);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerLabel, { color: palette.dim }]}>Spent today</Text>
        <Text style={[styles.headerValue, { color: palette.text }]}>
          {formatMoney(money(todayTotal, BASE_CURRENCY), 'fr-TN')}
        </Text>
      </View>

      <View style={styles.amountBlock}>
        <AmountDisplay draft={draft} currency={currency} palette={palette} />
        <Text
          style={[
            styles.savedToast,
            { color: justSaved ? palette.success : 'transparent' },
          ]}
        >
          {justSaved ? `Saved ${justSaved}` : ' '}
        </Text>
      </View>

      <View style={styles.currencyRow}>
        {CURRENCIES.map((code) => (
          <Pressable
            key={code}
            onPress={() => changeCurrency(code)}
            style={[
              styles.currencyChip,
              { borderColor: palette.border },
              currency === code
                ? { backgroundColor: palette.accent, borderColor: 'transparent' }
                : null,
            ]}
          >
            <Text
              style={[
                styles.currencyText,
                { color: currency === code ? '#fff' : palette.dim },
              ]}
            >
              {code}
            </Text>
          </Pressable>
        ))}
      </View>

      <CategoryChips
        categories={categories}
        selectedId={categoryId}
        onSelect={setCategoryId}
        palette={palette}
      />

      <AmountPad draft={draft} exponent={exponent} onChange={setDraft} palette={palette} />

      <Pressable
        onPress={save}
        disabled={!canSave}
        style={[styles.save, { backgroundColor: canSave ? palette.accent : palette.key }]}
      >
        <Text style={[styles.saveText, { color: canSave ? '#fff' : palette.dim }]}>
          Save
        </Text>
      </Pressable>

      <ScrollView style={styles.recent} contentContainerStyle={styles.recentContent}>
        {recent.length === 0 ? (
          <Text style={[styles.empty, { color: palette.dim }]}>Nothing logged yet.</Text>
        ) : (
          recent.map((expense) => {
            const category = categories.find((c) => c.id === expense.categoryId);
            return (
              <Pressable
                key={expense.id}
                onPress={() => setEditing(expense)}
                style={[styles.recentRow, { borderBottomColor: palette.divider }]}
                android_ripple={{ color: palette.ripple }}
              >
                <Text
                  style={[styles.recentLabel, { color: palette.text }]}
                  numberOfLines={1}
                >
                  {category ? `${category.icon ?? ''} ${category.name}` : 'Uncategorised'}
                  {expense.occurredOn === today ? '' : `  ·  ${expense.occurredOn}`}
                </Text>
                <View style={styles.recentRight}>
                  <Text style={[styles.recentAmount, { color: palette.text }]}>
                    {toDecimalString(expense.amount)} {expense.amount.currency}
                  </Text>
                  {expense.amount.currency !== BASE_CURRENCY ? (
                    <Text style={[styles.recentSub, { color: palette.dim }]}>
                      {expense.base
                        ? `${expense.baseEstimated ? '≈ ' : ''}${toDecimalString(expense.base)} ${BASE_CURRENCY}`
                        : 'awaiting statement'}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {editing ? (
        <ExpenseEditor
          expense={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 44 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headerLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  headerValue: { fontSize: 18, fontWeight: '700' },

  amountBlock: { marginTop: 12 },
  savedToast: { textAlign: 'center', fontSize: 13, height: 20, fontWeight: '600' },

  currencyRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  currencyChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  currencyText: { fontWeight: '600', fontSize: 13 },

  save: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveText: { fontSize: 17, fontWeight: '700' },

  recent: { flex: 1, marginTop: 8 },
  recentContent: { paddingBottom: 24 },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  recentLabel: { flexShrink: 1 },
  recentRight: { alignItems: 'flex-end' },
  recentAmount: { fontWeight: '600' },
  recentSub: { fontSize: 11, marginTop: 1 },
  empty: { textAlign: 'center', paddingVertical: 24 },
});
