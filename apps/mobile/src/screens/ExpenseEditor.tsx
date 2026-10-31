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
  type Category,
  type Expense,
  exponentOf,
  formatAmount,
  money,
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
import { Pill } from '../components/Industrial.js';
import { fonts, labelStyle, paletteFor } from '../components/theme.js';
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
              <Text style={[styles.headerTitle, { color: palette.text }]}>
                {describeDate(occurredOn)}
              </Text>
            </Pressable>
            <Pressable onPress={save} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.accentText }]}>Save</Text>
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
                  <Text style={[labelStyle, styles.fieldLabel, { color: palette.textFaint }]}>BILLED</Text>
                ) : null}
                <AmountDisplay draft={billed} currency={currency} palette={palette} />
              </View>
            </Pressable>

            <View style={styles.currencyRow}>
              {CURRENCIES.map((code) => (
                <Pill key={code} label={code} selected={currency === code} palette={palette} onPress={() => changeCurrency(code)} />
              ))}
            </View>

            {foreign ? (
              <Pressable onPress={() => setField('debited')}>
                <View style={field === 'debited' ? styles.activeField : undefined}>
                  <Text style={[labelStyle, styles.fieldLabel, { color: field === 'debited' ? palette.text : palette.textFaint }]}>
                    DEBITED BY THE BANK
                    {debited.whole === '' ? ' · NOT KNOWN YET' : ''}
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
              style={[styles.wordsRow, { backgroundColor: palette.surface }]}
            >
              <Text style={[styles.wordsText, { color: merchant || note ? palette.text : palette.dim }]} numberOfLines={2}>
                {merchant || note ? [merchant, note].filter(Boolean).join('  ·  ') : 'Where, and a note'}
              </Text>
              <Text style={[styles.wordsEdit, { color: palette.accentText }]}>Edit</Text>
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
                  Delete {formatAmount(expense.amount)}?
                </Text>
                <View style={styles.confirmButtons}>
                  <Pressable
                    onPress={() => setConfirmingDelete(false)}
                    style={[styles.confirmButton, { backgroundColor: palette.surface }]}
                  >
                    <Text style={[styles.confirmLabel, { color: palette.text }]}>Keep</Text>
                  </Pressable>
                  <Pressable
                    onPress={remove}
                    style={[styles.confirmButton, { backgroundColor: palette.danger }]}
                  >
                    <Text style={[styles.confirmLabel, { color: palette.onAccent }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setConfirmingDelete(true)} style={styles.deleteLink}>
                <Text style={[styles.confirmLabel, { color: palette.danger }]}>
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
  sheet: { maxHeight: '92%', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { fontFamily: fonts.monoMedium, fontSize: 13 },
  headerAction: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  dateRow: { paddingBottom: 8 },
  wordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    paddingHorizontal: 18,
    minHeight: 52,
    marginBottom: 10,
  },
  wordsText: { flex: 1, fontFamily: fonts.uiMedium, fontSize: 14 },
  wordsEdit: { fontFamily: fonts.uiSemibold, fontSize: 13 },

  fieldLabel: { marginTop: 8 },
  activeField: { opacity: 1 },
  hint: { fontFamily: fonts.ui, fontSize: 12, marginTop: 4, marginBottom: 4 },

  currencyRow: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end', marginTop: 10 },


  deleteLink: { alignItems: 'center', paddingVertical: 16 },
  confirmRow: { paddingTop: 12, gap: 10 },
  confirmText: { fontFamily: fonts.uiSemibold, textAlign: 'center' },
  confirmLabel: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  confirmButtons: { flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1, alignItems: 'center', paddingVertical: 15, borderRadius: 999 },
});
