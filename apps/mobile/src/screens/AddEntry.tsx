/**
 * Adding money: an expense, or money lent or borrowed, on one till.
 *
 * The three are the same gesture with a different "who": a category for an
 * expense, a person for a loan. Digits fill in from the right, like a card
 * terminal, so the decimals are always there. Category, then what it was for and
 * when on ruled lines, then the keypad and Save under the thumb. Save names the
 * amount, so the last thing read before committing is what is being committed.
 *
 * The category survives a save, so the second coffee of the week is amount then
 * Save; today is the default date; the dinar is the default currency.
 */

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  type Category,
  type Expense,
  exponentOf,
  formatAmount,
  type IsoDate,
  money,
  type Person,
  todayIn,
} from '@vaultp/core';

import { AmountPad } from '../components/AmountPad.js';
import { EMPTY_DRAFT, type Draft, draftDisplay, draftToMinor, retypeForExponent } from '../components/amount.js';
import { NewCategory } from '../components/CategoryChips.js';
import { describeDate } from '../components/DateField.js';
import { Button, Label, Pill, Tile } from '../components/Industrial.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { categoryIcon, Icon } from '../components/icons.js';
import { fonts, labelStyle, paletteFor, type Palette } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { ExpenseEditor } from './ExpenseEditor.js';

type Mode = 'expense' | 'lent' | 'borrowed';

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: 'expense', label: 'EXPENSE' },
  { key: 'lent', label: 'I LENT' },
  { key: 'borrowed', label: 'I BORROWED' },
];

const CURRENCIES = [BASE_CURRENCY, 'EUR', 'USD'] as const;

function toIso(date: Date): IsoDate {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function fromIso(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

export function AddEntry() {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [mode, setMode] = useState<Mode>('expense');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState<null | 'person' | 'category'>(null);
  const [saved, setSaved] = useState<{ text: string; expense: Expense | null } | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const categories = useMemo<Category[]>(() => vault.expenses.listCategories(), [vault, version]);
  const people = useMemo<Person[]>(() => vault.debts.listPeople(), [vault, version]);

  const exponent = exponentOf(currency);
  const amountMinor = draftToMinor(draft, exponent);
  const person = people.find((p) => p.id === personId) ?? null;
  const needsWho = mode !== 'expense' && person === null;
  const canSave = amountMinor > 0 && !needsWho;
  const shown = draftDisplay(draft, exponent);

  function cycleCurrency() {
    const next = CURRENCIES[(CURRENCIES.indexOf(currency as (typeof CURRENCIES)[number]) + 1) % CURRENCIES.length]!;
    setDraft((current) => retypeForExponent(current, exponentOf(next)));
    setCurrency(next);
  }

  function pickDate() {
    DateTimePickerAndroid.open({
      value: fromIso(date),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) setDate(toIso(picked));
      },
    });
  }

  function flash(text: string, expense: Expense | null) {
    setSaved({ text, expense });
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 3500);
  }

  function save() {
    if (!canSave) return;
    const amount = money(amountMinor, currency);
    const trimmedNote = note.trim();
    const trimmedMerchant = merchant.trim();

    if (mode === 'expense') {
      const expense = mutate((v) =>
        v.expenses.addExpense({
          occurredOn: date,
          amount,
          ...(categoryId ? { categoryId } : {}),
          ...(trimmedMerchant ? { merchant: trimmedMerchant } : {}),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        }),
      );
      if (expense) flash(`${formatAmount(expense.amount)} saved`, expense);
    } else {
      mutate((v) => {
        const input = {
          personId: personId!,
          amount,
          occurredOn: date,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        };
        return mode === 'lent' ? v.debts.lend(input) : v.debts.borrow(input);
      });
      flash(
        mode === 'lent'
          ? `Lent ${formatAmount(amount)} to ${person!.name}`
          : `Borrowed ${formatAmount(amount)} from ${person!.name}`,
        null,
      );
    }

    // The amount and words are for this entry only; the category, person, date
    // and currency are likely to be right for the next one too.
    setDraft(EMPTY_DRAFT);
    setMerchant('');
    setNote('');
  }

  const saveLabel =
    needsWho && amountMinor > 0
      ? mode === 'lent'
        ? 'Choose who you lent to'
        : 'Choose who you borrowed from'
      : `${mode === 'expense' ? 'Save' : mode === 'lent' ? 'Lend' : 'Borrow'} ${shown} ${currency}`;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.seg, { backgroundColor: palette.surface }]} accessibilityRole="tablist">
        {MODES.map((option) => {
          const active = option.key === mode;
          return (
            <Pressable
              key={option.key}
              onPress={() => setMode(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segItem, { backgroundColor: active ? palette.text : 'transparent' }]}
            >
              <Text style={[labelStyle, styles.segText, { color: active ? palette.background : palette.dim }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Tile palette={palette}>
        <View style={styles.labelRow}>
          <Label palette={palette}>AMOUNT</Label>
          <Pressable onPress={cycleCurrency} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change currency">
            <Label palette={palette} colour={palette.text}>
              {currency} · {exponent} DECIMALS
            </Label>
          </Pressable>
        </View>
        <Text style={[styles.amount, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {shown}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {mode === 'expense'
            ? categories.map((c) => (
                <Pill
                  key={c.id}
                  label={c.name}
                  icon={categoryIcon(c.name)}
                  selected={c.id === categoryId}
                  palette={palette}
                  onPress={() => setCategoryId(c.id === categoryId ? null : c.id)}
                />
              ))
            : people.map((p) => (
                <Pill
                  key={p.id}
                  label={p.name}
                  selected={p.id === personId}
                  palette={palette}
                  onPress={() => setPersonId(p.id === personId ? null : p.id)}
                />
              ))}
          <Pill
            label={mode === 'expense' ? '+ New category' : '+ Someone new'}
            palette={palette}
            onPress={() => setPrompt(mode === 'expense' ? 'category' : 'person')}
          />
        </ScrollView>

        <View style={[styles.lines, { borderTopColor: palette.border }]}>
          {mode === 'expense' ? (
            <Line label="FOR" palette={palette}>
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                placeholder="Shop, café, service"
                placeholderTextColor={palette.textFaint}
                maxLength={120}
                style={[styles.lineInput, { color: palette.text }]}
              />
            </Line>
          ) : null}
          <Pressable onPress={pickDate} accessibilityRole="button" accessibilityLabel="Change the date">
            <Line label="WHEN" palette={palette}>
              <Text style={[styles.lineText, { color: palette.text }]}>{date === today ? 'Today' : describeDate(date)}</Text>
              <Icon name="clock" size={16} color={palette.dim} />
            </Line>
          </Pressable>
          <Line label="NOTE" palette={palette} last>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={mode === 'expense' ? 'Anything to remember' : 'What it was for'}
              placeholderTextColor={palette.textFaint}
              maxLength={200}
              style={[styles.lineInput, { color: palette.text }]}
            />
          </Line>
        </View>
      </Tile>

      <AmountPad draft={draft} exponent={exponent} onChange={setDraft} palette={palette} />

      <Button label={saveLabel} tone="accent" disabled={!canSave} palette={palette} onPress={save} />

      {saved ? (
        <Pressable
          onPress={() => saved.expense && setEditing(saved.expense)}
          accessibilityRole="button"
          style={[styles.toast, { backgroundColor: palette.text }]}
        >
          <Icon name="check" size={16} stroke={2.2} color={palette.background} />
          <Text style={[styles.toastText, { color: palette.background }]} numberOfLines={1}>
            {saved.text}
            {saved.expense ? '  ·  Edit' : ''}
          </Text>
        </Pressable>
      ) : null}

      {prompt === 'person' ? (
        <TextPrompt
          title="Someone new"
          placeholder="Their name"
          action="Add"
          palette={palette}
          onCancel={() => setPrompt(null)}
          onSave={(name) => {
            const created = mutate((v) => v.debts.addPerson({ name }));
            if (created) setPersonId(created.id);
            setPrompt(null);
          }}
        />
      ) : null}

      {prompt === 'category' ? (
        <NewCategory
          palette={palette}
          onClose={() => setPrompt(null)}
          onCreated={(created) => {
            setCategoryId(created.id);
            setPrompt(null);
          }}
        />
      ) : null}

      {editing ? (
        <ExpenseEditor
          expense={editing}
          categories={categories}
          onClose={() => {
            setEditing(null);
            setSaved(null);
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function Line({
  label,
  last = false,
  palette,
  children,
}: {
  label: string;
  last?: boolean;
  palette: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.line, last ? null : { borderBottomWidth: 1, borderBottomColor: palette.border }]}>
      <Text style={[labelStyle, styles.lineLabel, { color: palette.textFaint }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 16, gap: 10 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  seg: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999 },
  segItem: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segText: { letterSpacing: 1.2 },

  amount: { fontFamily: fonts.display, fontSize: 60, lineHeight: 64, textAlign: 'right' },
  chips: { gap: 6 },

  lines: { borderTopWidth: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 46 },
  lineLabel: { width: 52 },
  lineInput: { flex: 1, fontFamily: fonts.uiMedium, fontSize: 15, padding: 0 },
  lineText: { flex: 1, fontFamily: fonts.uiMedium, fontSize: 15 },

  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    maxWidth: '100%',
  },
  toastText: { fontFamily: fonts.uiSemibold, fontSize: 14, flexShrink: 1 },
});
