/**
 * Adding money: an expense, or money lent or borrowed — one sheet.
 *
 * The three are the same gesture with a different "who": a category for an
 * expense, a person for a loan. So they share one screen, in the manner of Ivy
 * Wallet's add sheet, rather than living in two places that feel unrelated.
 *
 * The amount is the hero, on a band of colour that says what is being recorded:
 * the chosen category's own colour for an expense, sage for money lent (it will
 * come back), ochre for money borrowed (it will go out). Everything else sits
 * below in the order a hand reaches for it — who, when, a note, then the keypad
 * and Save under the thumb.
 *
 * Kept from the old quick entry, because they were right: the category survives
 * a save, so the second coffee of the week is amount then Save; today is the
 * default date; the dinar is the default currency.
 */

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  type Category,
  categoryColourFor,
  type Expense,
  exponentOf,
  formatAmount,
  type IsoDate,
  money,
  type Person,
  radii,
  spacing,
  todayIn,
  typeScale,
} from '@vaultp/core';

import { AmountPad } from '../components/AmountPad.js';
import { EMPTY_DRAFT, type Draft, draftDisplay, draftToMinor, retypeForExponent } from '../components/amount.js';
import { Avatar } from '../components/Avatar.js';
import { NewCategory } from '../components/CategoryChips.js';
import { describeDate } from '../components/DateField.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { paletteFor } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { ExpenseEditor } from './ExpenseEditor.js';

type Mode = 'expense' | 'lent' | 'borrowed';

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: 'expense', label: 'Expense' },
  { key: 'lent', label: 'I lent' },
  { key: 'borrowed', label: 'I borrowed' },
];

const CURRENCIES = [BASE_CURRENCY, 'EUR', 'USD'] as const;

/** Deep cuts of sage and ochre from the category palette: white reads on both. */
const LENT_BAND = '#43795C';
const BORROWED_BAND = '#9A7127';

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
  const scheme = useColorScheme();
  const palette = paletteFor(scheme);
  const today = todayIn();

  const [mode, setMode] = useState<Mode>('expense');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState<null | 'note' | 'person' | 'category'>(null);
  const [saved, setSaved] = useState<{ text: string; expense: Expense | null } | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const categories = useMemo<Category[]>(() => vault.expenses.listCategories(), [vault, version]);
  const people = useMemo<Person[]>(() => vault.debts.listPeople(), [vault, version]);

  const exponent = exponentOf(currency);
  const amountMinor = draftToMinor(draft, exponent);
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const person = people.find((p) => p.id === personId) ?? null;
  const needsWho = mode !== 'expense' && person === null;
  const canSave = amountMinor > 0 && !needsWho;

  const band =
    mode === 'lent'
      ? LENT_BAND
      : mode === 'borrowed'
        ? BORROWED_BAND
        : category
          ? categoryColourFor(category.id, category.color)
          : null;
  const onBand = band ? '#fff' : palette.text;
  const onBandDim = band ? 'rgba(255, 255, 255, 0.78)' : palette.dim;

  const when = date === today ? 'today' : describeDate(date);
  const context =
    mode === 'expense'
      ? `${category ? category.name : 'No category'} · ${when}`
      : mode === 'lent'
        ? `${person ? `To ${person.name}` : 'Choose who'} · ${when}`
        : `${person ? `From ${person.name}` : 'Choose who'} · ${when}`;

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

    if (mode === 'expense') {
      const expense = mutate((v) =>
        v.expenses.addExpense({
          occurredOn: date,
          amount,
          ...(categoryId ? { categoryId } : {}),
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

    // The amount and note are for this entry only; the category, person, date
    // and currency are likely to be right for the next one too.
    setDraft(EMPTY_DRAFT);
    setNote('');
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* The band: what is being recorded, and how much. */}
      <View style={[styles.band, { backgroundColor: band ?? palette.surface }]}>
        <View style={[styles.modes, { backgroundColor: band ? 'rgba(0, 0, 0, 0.22)' : palette.key }]}>
          {MODES.map((option) => {
            const active = option.key === mode;
            return (
              <Pressable
                key={option.key}
                onPress={() => setMode(option.key)}
                style={({ pressed }) => [
                  styles.mode,
                  active ? { backgroundColor: palette.background } : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.modeText, { color: active ? palette.text : onBandDim }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.context, { color: onBandDim }]} numberOfLines={1}>
          {context}
        </Text>
        <Pressable onPress={cycleCurrency} style={styles.amountRow} accessibilityLabel="Change currency">
          <Text style={[styles.amount, { color: onBand }]} numberOfLines={1} adjustsFontSizeToFit>
            {draftDisplay(draft)}
          </Text>
          <Text style={[styles.currency, { color: onBandDim }]}>{currency}</Text>
        </Pressable>
        {saved ? (
          <Pressable
            onPress={() => saved.expense && setEditing(saved.expense)}
            style={[styles.saved, { backgroundColor: band ? 'rgba(0, 0, 0, 0.22)' : palette.key }]}
          >
            <Text style={[styles.savedText, { color: onBand }]}>
              ✓ {saved.text}
              {saved.expense ? '  ·  Edit' : ''}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.savedSpace} />
        )}
      </View>

      <View style={styles.body}>
        {/* Who: categories for an expense, people for a loan. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tiles}
          keyboardShouldPersistTaps="handled"
        >
          {mode === 'expense'
            ? categories.map((c) => (
                <Tile
                  key={c.id}
                  label={c.name}
                  selected={c.id === categoryId}
                  palette={palette}
                  onPress={() => setCategoryId(c.id === categoryId ? null : c.id)}
                >
                  <View style={[styles.tileIcon, { backgroundColor: categoryColourFor(c.id, c.color) }]}>
                    <Text style={styles.tileGlyph}>{c.icon ?? c.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                </Tile>
              ))
            : people.map((p) => (
                <Tile
                  key={p.id}
                  label={p.name}
                  selected={p.id === personId}
                  palette={palette}
                  onPress={() => setPersonId(p.id === personId ? null : p.id)}
                >
                  <Avatar id={p.id} name={p.name} size={44} />
                </Tile>
              ))}
          <Tile
            label={mode === 'expense' ? 'Other' : 'Someone new'}
            selected={false}
            palette={palette}
            onPress={() => setPrompt(mode === 'expense' ? 'category' : 'person')}
          >
            <View style={[styles.tileIcon, styles.tileNew, { borderColor: palette.dim }]}>
              <Text style={[styles.tileGlyph, { color: palette.dim }]}>＋</Text>
            </View>
          </Tile>
        </ScrollView>

        <View style={styles.chips}>
          <Chip label={date === today ? 'Today' : describeDate(date)} glyph="📅" palette={palette} onPress={pickDate} />
          <Chip label={currency} glyph="💱" palette={palette} onPress={cycleCurrency} />
          <Chip
            label={note.trim() ? note.trim() : 'Note'}
            glyph="✎"
            faint={!note.trim()}
            palette={palette}
            onPress={() => setPrompt('note')}
          />
        </View>

        <AmountPad draft={draft} exponent={exponent} onChange={setDraft} palette={palette} />

        <Pressable
          onPress={save}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.save,
            { backgroundColor: canSave ? palette.accent : palette.key },
            pressed && canSave ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.saveText, { color: canSave ? palette.onAccent : palette.dim }]}>
            {needsWho && amountMinor > 0
              ? mode === 'lent'
                ? 'Choose who you lent to'
                : 'Choose who you borrowed from'
              : mode === 'expense'
                ? 'Save expense'
                : mode === 'lent'
                  ? 'Record the loan'
                  : 'Record what I borrowed'}
          </Text>
        </Pressable>
      </View>

      {prompt === 'note' ? (
        <TextPrompt
          title="Note"
          placeholder={mode === 'expense' ? 'Where, or what for' : 'What it was for'}
          initial={note}
          allowEmpty
          palette={palette}
          onCancel={() => setPrompt(null)}
          onSave={(value) => {
            setNote(value);
            setPrompt(null);
          }}
        />
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
    </View>
  );
}

function Tile({
  label,
  selected,
  palette,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  palette: ReturnType<typeof paletteFor>;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}>
      <View style={[styles.tileRing, { borderColor: selected ? palette.text : 'transparent' }]}>{children}</View>
      <Text
        numberOfLines={1}
        style={[styles.tileLabel, { color: selected ? palette.text : palette.dim, fontWeight: selected ? '700' : '500' }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  glyph,
  faint,
  palette,
  onPress,
}: {
  label: string;
  glyph: string;
  faint?: boolean;
  palette: ReturnType<typeof paletteFor>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { borderColor: palette.border }, pressed ? styles.pressed : null]}
    >
      <Text style={styles.chipGlyph}>{glyph}</Text>
      <Text numberOfLines={1} style={[styles.chipText, { color: faint ? palette.dim : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressed: { transform: [{ scale: 0.97 }] },

  band: {
    paddingTop: 4,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  modes: { flexDirection: 'row', borderRadius: radii.pill, padding: 3 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.pill },
  modeText: { fontSize: typeScale.sm, fontWeight: '600' },
  context: { textAlign: 'center', marginTop: spacing.lg, fontSize: typeScale.sm, fontWeight: '500' },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 2 },
  amount: {
    fontSize: 54,
    fontWeight: '300',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    maxWidth: '82%',
  },
  currency: { fontSize: typeScale.lg, marginBottom: 10, marginLeft: 8, fontWeight: '600' },
  saved: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  savedText: { fontSize: typeScale.sm, fontWeight: '600' },
  savedSpace: { height: 34 },

  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, justifyContent: 'flex-end', gap: spacing.sm },
  tiles: { gap: spacing.md, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  tile: { width: 68, alignItems: 'center', gap: 5 },
  tileRing: { padding: 2, borderRadius: 18, borderWidth: 2 },
  tileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileNew: { borderWidth: 1.5, borderStyle: 'dashed' },
  tileGlyph: { fontSize: 20, color: '#fff', fontWeight: '700' },
  tileLabel: { fontSize: typeScale.xs, maxWidth: 68 },

  chips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    flexShrink: 1,
  },
  chipGlyph: { fontSize: 13 },
  chipText: { fontSize: typeScale.sm, fontWeight: '500', flexShrink: 1 },

  save: { borderRadius: radii.lg, paddingVertical: 16, alignItems: 'center' },
  saveText: { fontSize: typeScale.md, fontWeight: '700' },
});
