/**
 * Correcting an expense.
 *
 * Exists because a daily-use app without undo is not finished: mistype 300 as
 * 3000 and, until now, it was stuck there forever.
 *
 * The foreign-currency case is why this is a sheet rather than a single field. A
 * dollar subscription has two amounts — what the vendor billed and what the bank
 * actually took — and they are entered at different times, because the statement
 * arrives days later. Both are shown, and either can be tapped to edit.
 */

import { useState } from 'react';
import {
  Modal,
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
  money,
  toDecimalString,
  type Category,
  type Expense,
} from '@vaultp/core';

import { AmountDisplay, AmountPad } from '../components/AmountPad.js';
import { CategoryChips } from '../components/CategoryChips.js';
import { DateField, describeDate } from '../components/DateField.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import {
  type Draft,
  draftFromMinor,
  draftToMinor,
  retypeForExponent,
} from '../components/amount.js';
import { paletteFor } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';

const CURRENCIES = [BASE_CURRENCY, 'USD', 'EUR'] as const;

type Field = 'billed' | 'debited';

export function ExpenseEditor({
  expense,
  categories,
  onClose,
}: {
  expense: Expense;
  categories: readonly Category[];
  onClose: () => void;
}) {
  const { mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [currency, setCurrency] = useState<string>(expense.amount.currency);
  const [billed, setBilled] = useState<Draft>(
    draftFromMinor(expense.amount.amountMinor, exponentOf(expense.amount.currency)),
  );
  const [debited, setDebited] = useState<Draft>(
    expense.base && expense.amount.currency !== BASE_CURRENCY && !expense.baseEstimated
      ? draftFromMinor(expense.base.amountMinor, exponentOf(BASE_CURRENCY))
      : { whole: '', fraction: null },
  );
  const [field, setField] = useState<Field>('billed');
  const [categoryId, setCategoryId] = useState<string | null>(expense.categoryId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Editable, because an expense is often logged the morning after it happened.
  const [occurredOn, setOccurredOn] = useState(expense.occurredOn);
  const [editingDate, setEditingDate] = useState(false);
  const [merchant, setMerchant] = useState(expense.merchant ?? '');
  const [note, setNote] = useState(expense.note ?? '');
  const [editingWords, setEditingWords] = useState(false);

  const foreign = currency !== BASE_CURRENCY;
  const activeDraft = field === 'billed' ? billed : debited;
  const activeExponent = field === 'billed' ? exponentOf(currency) : exponentOf(BASE_CURRENCY);

  function changeCurrency(next: string) {
    // Keep what was typed and re-read it under the new exponent: 20,00 entered as
    // dollars should stay twenty when switched to dinars, not become two.
    setBilled((current) => retypeForExponent(current, exponentOf(next)));
    setCurrency(next);
    if (next === BASE_CURRENCY) setField('billed');
  }

  function save() {
    const billedMinor = draftToMinor(billed, exponentOf(currency));
    if (billedMinor <= 0) return;

    const debitedMinor = draftToMinor(debited, exponentOf(BASE_CURRENCY));

    mutate((vault) =>
      vault.expenses.updateExpense(expense.id, {
        amount: money(billedMinor, currency),
        occurredOn,
        categoryId: categoryId ?? '',
        merchant,
        note,
        // Only send the debited figure when it was actually filled in; an empty
        // field means "not known yet", not "zero".
        ...(foreign && debitedMinor > 0
          ? { charged: money(debitedMinor, BASE_CURRENCY) }
          : {}),
      }),
    );
    onClose();
  }

  function remove() {
    mutate((vault) => vault.expenses.deleteExpense(expense.id));
    onClose();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.dim }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => setEditingDate((current) => !current)} hitSlop={8}>
              <Text style={[styles.headerTitle, { color: palette.accent }]}>
                {describeDate(occurredOn)}
              </Text>
            </Pressable>
            <Pressable onPress={save} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.accent }]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {editingDate ? (
              <View style={styles.dateRow}>
                <DateField
                  value={occurredOn}
                  onChange={(next) => {
                    if (next !== '') setOccurredOn(next);
                    setEditingDate(false);
                  }}
                  clearable={false}
                  palette={palette}
                />
              </View>
            ) : null}

            <Pressable onPress={() => setField('billed')}>
              <View style={field === 'billed' && foreign ? styles.activeField : undefined}>
                {foreign ? (
                  <Text style={[styles.fieldLabel, { color: palette.dim }]}>Billed</Text>
                ) : null}
                <AmountDisplay draft={billed} currency={currency} palette={palette} />
              </View>
            </Pressable>

            <View style={styles.currencyRow}>
              {CURRENCIES.map((code) => (
                <Pressable
                  key={code}
                  onPress={() => changeCurrency(code)}
                  style={[
                    styles.currencyChip,
                    { borderColor: palette.border },
                    currency === code ? { backgroundColor: palette.accent, borderColor: 'transparent' } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.currencyText,
                      { color: currency === code ? '#fff' : palette.text },
                    ]}
                  >
                    {code}
                  </Text>
                </Pressable>
              ))}
            </View>

            {foreign ? (
              <Pressable onPress={() => setField('debited')}>
                <View style={field === 'debited' ? styles.activeField : undefined}>
                  <Text style={[styles.fieldLabel, { color: palette.dim }]}>
                    Debited by the bank
                    {debited.whole === '' ? ' — not known yet' : ''}
                  </Text>
                  <AmountDisplay
                    draft={debited}
                    currency={BASE_CURRENCY}
                    palette={palette}
                  />
                  <Text style={[styles.hint, { color: palette.dim }]}>
                    Leave blank until the statement arrives. The total will show it as
                    an estimate rather than a fact.
                  </Text>
                </View>
              </Pressable>
            ) : null}

            <CategoryChips
              categories={categories}
              selectedId={categoryId}
              onSelect={setCategoryId}
              palette={palette}
            />

            <Pressable
              onPress={() => setEditingWords(true)}
              style={[styles.wordsRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <Text style={[styles.wordsText, { color: merchant || note ? palette.text : palette.dim }]} numberOfLines={2}>
                {merchant || note ? [merchant, note].filter(Boolean).join('  ·  ') : 'Where, and a note'}
              </Text>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>Edit</Text>
            </Pressable>

            <AmountPad
              draft={activeDraft}
              exponent={activeExponent}
              onChange={field === 'billed' ? setBilled : setDebited}
              palette={palette}
            />

            {confirmingDelete ? (
              <View style={styles.confirmRow}>
                <Text style={[styles.confirmText, { color: palette.text }]}>
                  Delete {toDecimalString(expense.amount)} {expense.amount.currency}?
                </Text>
                <View style={styles.confirmButtons}>
                  <Pressable
                    onPress={() => setConfirmingDelete(false)}
                    style={[styles.confirmButton, { backgroundColor: palette.surface }]}
                  >
                    <Text style={{ color: palette.text, fontWeight: '600' }}>Keep</Text>
                  </Pressable>
                  <Pressable
                    onPress={remove}
                    style={[styles.confirmButton, { backgroundColor: palette.danger }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setConfirmingDelete(true)} style={styles.deleteLink}>
                <Text style={{ color: palette.danger, fontWeight: '600' }}>
                  Delete this expense
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>

      {editingWords ? (
        <FieldsSheet
          title="Where, and a note"
          palette={palette}
          fields={[
            { key: 'merchant', label: 'Where', initial: merchant, placeholder: 'Shop, café, service' },
            { key: 'note', label: 'Note', initial: note, placeholder: 'Anything to remember' },
          ]}
          saveLabel="Done"
          onCancel={() => setEditingWords(false)}
          onSave={(values) => {
            setMerchant(values.merchant ?? '');
            setNote(values.note ?? '');
            setEditingWords(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { fontWeight: '600' },
  headerAction: { fontSize: 16, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 32 },
  dateRow: { paddingBottom: 8 },
  wordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  wordsText: { flex: 1, fontSize: 14 },

  fieldLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  activeField: { opacity: 1 },
  hint: { fontSize: 12, marginTop: 4, marginBottom: 4 },

  currencyRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12 },
  currencyChip: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  currencyText: { fontWeight: '600' },


  deleteLink: { alignItems: 'center', paddingVertical: 16 },
  confirmRow: { paddingTop: 12, gap: 10 },
  confirmText: { textAlign: 'center', fontWeight: '600' },
  confirmButtons: { flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12 },
});
