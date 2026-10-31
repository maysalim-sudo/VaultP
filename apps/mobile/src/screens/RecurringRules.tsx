/**
 * Repeats: the things you should never type twice.
 *
 * The next thirty days lead, as a total, then every charge by the date it comes
 * round, marked AUTO if it logs itself or REMIND if it waits for you. A reminder
 * due within three days turns orange: it is the only one that needs you.
 *
 * Tap a rule to change its name, schedule, category or price, or to pause it.
 * Pausing is the usual way to stop one; deleting is for a rule that was a
 * mistake, and even then the expenses it already logged stay, because they
 * happened.
 */

import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import {
  BASE_CURRENCY,
  type Category,
  daysBetween,
  exponentOf,
  formatAmount,
  formatAmountParts,
  type Frequency,
  money,
  nextOccurrenceOnOrAfter,
  type RecurringRule,
  todayIn,
  upcomingCharges,
} from '@vaultp/core';

import { AmountDisplay, AmountPad } from '../components/AmountPad.js';
import { AmountSheet } from '../components/AmountSheet.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import { Empty, Figure, Label, PageHead, Pill, Tile } from '../components/Industrial.js';
import { EMPTY_DRAFT, type Draft, draftToMinor, retypeForExponent } from '../components/amount.js';
import { Screen } from '../components/Screen.js';
import { categoryIcon, Icon } from '../components/icons.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';

const CURRENCIES = [BASE_CURRENCY, 'USD', 'EUR'] as const;
const FREQUENCIES: ReadonlyArray<{ value: Frequency; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'daily', label: 'Daily' },
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** How close a reminder has to be before it asks for attention. */
const HOT_WITHIN_DAYS = 3;

export function RecurringRules({
  categories,
  onClose,
}: {
  categories: readonly Category[];
  onClose?: () => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [repricing, setRepricing] = useState<RecurringRule | null>(null);

  const rules = useMemo(() => vault.expenses.listRules(), [vault, version]);
  const active = rules
    .filter((rule) => rule.state === 'active')
    .map((rule) => ({ rule, next: nextOccurrenceOnOrAfter(rule, today) }))
    .sort((a, b) => a.next.localeCompare(b.next));
  const inactive = rules.filter((rule) => rule.state !== 'active');

  // Dinars only: a foreign charge has no value until the statement lands, so it
  // is counted apart rather than guessed into the total.
  const coming = useMemo(() => upcomingCharges(vault.expenses, today, 30), [vault, version, today]);
  let comingMinor = 0;
  let comingForeign = 0;
  for (const charge of coming) {
    if (charge.rule.amount.currency === BASE_CURRENCY) comingMinor += charge.rule.amount.amountMinor;
    else comingForeign += 1;
  }
  const comingParts = formatAmountParts(money(comingMinor, BASE_CURRENCY));

  return (
    <Screen onClose={onClose}>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.body}>
          <PageHead title="Repeats" action="Rule" onAction={() => setAdding(true)} palette={palette} />

          {rules.length === 0 ? (
            <Empty palette={palette}>NOTHING REPEATS YET. RENT, A SUBSCRIPTION: ANYTHING YOU WOULD TYPE EVERY MONTH.</Empty>
          ) : (
            <Tile palette={palette}>
              <Label palette={palette}>
                NEXT 30 DAYS · {coming.length} CHARGE{coming.length === 1 ? '' : 'S'}
              </Label>
              <Figure value={comingParts.figure} unit={comingParts.unit} size={46} palette={palette} />
              {comingForeign > 0 ? (
                <Text style={[styles.note, { color: palette.estimate }]}>
                  + {comingForeign} in another currency, valued when the statement lands
                </Text>
              ) : null}
            </Tile>
          )}

          {active.length + inactive.length > 0 ? (
            <View style={[styles.list, { backgroundColor: palette.surface }]}>
              {active.map(({ rule, next }, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  next={next}
                  today={today}
                  first={index === 0}
                  categories={categories}
                  palette={palette}
                  onEdit={() => setEditing(rule)}
                />
              ))}
              {inactive.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  next={null}
                  today={today}
                  first={active.length === 0 && index === 0}
                  categories={categories}
                  palette={palette}
                  onEdit={() => setEditing(rule)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>

        {editing ? (
          <FieldsSheet
            title="Edit recurring charge"
            palette={palette}
            fields={[{ key: 'name', label: 'Name', initial: editing.name, required: true }]}
            choices={[
              {
                key: 'frequency',
                label: 'Repeats',
                initial: editing.frequency,
                options: FREQUENCIES.map((frequency) => ({ value: frequency.value, label: frequency.label })),
              },
              {
                key: 'category',
                label: 'Category',
                initial: editing.categoryId ?? '',
                options: [
                  { value: '', label: 'None' },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ],
              },
              {
                key: 'autoLog',
                label: 'When it comes due',
                initial: editing.autoLog ? 'yes' : 'no',
                options: [
                  { value: 'yes', label: 'Log it for me' },
                  { value: 'no', label: 'Just remind me' },
                ],
              },
            ]}
            footnote={`Costs ${formatAmount(editing.amount)}. Expenses it already logged stay as they are.`}
            actions={[
              {
                label: 'Change price',
                onPress: () => {
                  setRepricing(editing);
                  setEditing(null);
                },
              },
              {
                label: editing.state === 'active' ? 'Pause' : 'Resume',
                onPress: () => {
                  const rule = editing;
                  setEditing(null);
                  mutate((v) => v.expenses.setRuleState(rule.id, rule.state === 'active' ? 'paused' : 'active'));
                },
              },
              {
                label: 'Delete',
                destructive: true,
                onPress: () => {
                  const rule = editing;
                  setEditing(null);
                  Alert.alert(`Delete ${rule.name}?`, 'Charges it already logged stay in your expenses.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => mutate((v) => v.expenses.deleteRule(rule.id)) },
                  ]);
                },
              },
            ]}
            onCancel={() => setEditing(null)}
            onSave={(values) => {
              const id = editing.id;
              setEditing(null);
              mutate((v) =>
                v.expenses.updateRule(id, {
                  name: values.name ?? '',
                  frequency: (values.frequency as Frequency) ?? 'monthly',
                  categoryId: values.category || null,
                  autoLog: values.autoLog === 'yes',
                }),
              );
            }}
          />
        ) : null}

        {repricing ? (
          <AmountSheet
            title={`${repricing.name}: new price`}
            hint="The old price is kept, so a rise still shows."
            initialMinor={repricing.amount.amountMinor}
            currency={repricing.amount.currency}
            onCancel={() => setRepricing(null)}
            onSave={(minor, currency) => {
              const id = repricing.id;
              setRepricing(null);
              if (minor > 0) mutate((v) => v.expenses.updateRuleAmount(id, money(minor, currency)));
            }}
          />
        ) : null}

        {adding ? <NewRuleForm categories={categories} palette={palette} onClose={() => setAdding(false)} /> : null}
      </View>
    </Screen>
  );
}

function RuleRow({
  rule,
  next,
  today,
  first,
  categories,
  palette,
  onEdit,
}: {
  rule: RecurringRule;
  /** Null when paused: there is no next date. */
  next: string | null;
  today: string;
  first: boolean;
  categories: readonly Category[];
  palette: Palette;
  onEdit: () => void;
}) {
  const category = categories.find((c) => c.id === rule.categoryId);
  const hot = next !== null && !rule.autoLog && daysBetween(today, next) <= HOT_WITHIN_DAYS;
  const mode = next === null ? 'PAUSED' : rule.autoLog ? 'AUTO' : 'REMIND';
  const every = FREQUENCIES.find((frequency) => frequency.value === rule.frequency)?.label ?? rule.frequency;

  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${rule.name}`}
      style={({ pressed }) => [
        styles.row,
        first ? null : { borderTopWidth: 1, borderTopColor: palette.border },
        next === null ? styles.paused : null,
        pressed ? { backgroundColor: palette.key } : null,
      ]}
    >
      <View style={styles.date}>
        <Text style={[styles.dateDay, { color: palette.text }]}>{next ? next.slice(8, 10) : '—'}</Text>
        <Label palette={palette}>{next ? MONTHS[Number(next.slice(5, 7)) - 1] : 'OFF'}</Label>
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTitle}>
          <Icon name={categoryIcon(category?.name ?? rule.name)} size={14} color={palette.dim} />
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {rule.name}
          </Text>
        </View>
        <Text style={[styles.meta, { color: palette.dim }]} numberOfLines={1}>
          {[every, category?.name].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.amount, { color: palette.text }]}>{formatAmount(rule.amount, { unit: rule.amount.currency === BASE_CURRENCY ? 'none' : 'code' })}</Text>
        <View style={[styles.tag, { backgroundColor: hot ? palette.accent : palette.key }]}>
          <Text style={[styles.tagText, { color: hot ? palette.onAccent : palette.dim }]}>{mode}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function NewRuleForm({
  categories,
  palette,
  onClose,
}: {
  categories: readonly Category[];
  palette: Palette;
  onClose: () => void;
}) {
  const { mutate } = useOpenVault();
  const today = todayIn();

  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(Number(today.slice(8, 10)));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [autoLog, setAutoLog] = useState(true);

  const exponent = exponentOf(currency);
  const amountMinor = draftToMinor(draft, exponent);
  const canSave = name.trim() !== '' && amountMinor > 0;

  /**
   * The anchor sets the day the rule fires. For a monthly rule that day matters
   * (rent on the 1st, a subscription on the 15th), so it is chosen directly
   * rather than inferred from whenever the rule happened to be created.
   */
  const anchorDate =
    frequency === 'monthly' ? `${today.slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}` : today;

  function save() {
    if (!canSave) return;
    mutate((vault) =>
      vault.expenses.addRule({
        name: name.trim(),
        amount: money(amountMinor, currency),
        frequency,
        anchorDate,
        autoLog,
        ...(categoryId ? { categoryId } : {}),
      }),
    );
    onClose();
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.formPage, { backgroundColor: palette.background }]}>
        <View style={styles.formHead}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.headAction, { color: palette.dim }]}>Cancel</Text>
          </Pressable>
          <Label palette={palette}>NEW RULE</Label>
          <Pressable onPress={save} hitSlop={12} disabled={!canSave} accessibilityRole="button">
            <Text style={[styles.headAction, { color: canSave ? palette.accentText : palette.textFaint }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Rent, Netflix, gym…"
            placeholderTextColor={palette.textFaint}
            style={[styles.nameInput, { color: palette.text, backgroundColor: palette.surface }]}
          />

          <Tile palette={palette}>
            <AmountDisplay draft={draft} currency={currency} palette={palette} />
            <View style={styles.wrap}>
              {CURRENCIES.map((code) => (
                <Pill
                  key={code}
                  label={code}
                  selected={currency === code}
                  palette={palette}
                  onPress={() => {
                    setDraft((current) => retypeForExponent(current, exponentOf(code)));
                    setCurrency(code);
                  }}
                />
              ))}
            </View>
          </Tile>

          <View style={styles.wrap}>
            {FREQUENCIES.map((option) => (
              <Pill
                key={option.value}
                label={option.label}
                selected={frequency === option.value}
                palette={palette}
                onPress={() => setFrequency(option.value)}
              />
            ))}
          </View>

          {frequency === 'monthly' ? (
            <>
              <Label palette={palette}>DAY OF THE MONTH</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripRow}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <Pill
                    key={day}
                    label={String(day)}
                    selected={dayOfMonth === day}
                    palette={palette}
                    onPress={() => setDayOfMonth(day)}
                  />
                ))}
              </ScrollView>
              {dayOfMonth > 28 ? (
                // The engine clamps and returns to the chosen day next month; say
                // so, because "31st" silently becoming "28th" forever is the bug
                // people expect here.
                <Text style={[styles.note, { color: palette.dim }]}>
                  Short months use their last day, then it returns to the {dayOfMonth}th.
                </Text>
              ) : null}
            </>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripRow}>
            {categories.map((category) => (
              <Pill
                key={category.id}
                label={category.name}
                icon={categoryIcon(category.name)}
                selected={categoryId === category.id}
                palette={palette}
                onPress={() => setCategoryId(categoryId === category.id ? null : category.id)}
              />
            ))}
          </ScrollView>

          <Pressable
            onPress={() => setAutoLog((current) => !current)}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoLog }}
            style={[styles.toggle, { backgroundColor: palette.surface }]}
          >
            <View style={styles.toggleText}>
              <Text style={[styles.name, { color: palette.text }]}>{autoLog ? 'Log it automatically' : 'Just remind me'}</Text>
              <Text style={[styles.meta, { color: palette.dim }]}>
                {autoLog
                  ? 'The expense appears on its own, on the day it is due.'
                  : 'It waits for you to confirm the amount before being logged.'}
              </Text>
            </View>
            <View style={[styles.switch, { backgroundColor: autoLog ? palette.accent : palette.key }]}>
              <View
                style={[
                  styles.knob,
                  { backgroundColor: autoLog ? palette.onAccent : palette.dim },
                  autoLog ? styles.knobOn : styles.knobOff,
                ]}
              />
            </View>
          </Pressable>

          <AmountPad draft={draft} exponent={exponent} onChange={setDraft} palette={palette} />
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
  note: { fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },

  list: { borderRadius: 22, paddingVertical: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66, paddingVertical: 12, paddingHorizontal: 18 },
  paused: { opacity: 0.55 },
  date: { width: 44, alignItems: 'center', gap: 2 },
  dateDay: { fontFamily: fonts.display, fontSize: 22, lineHeight: 24 },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: fonts.uiSemibold, fontSize: 15, flexShrink: 1 },
  meta: { fontFamily: fonts.ui, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: 5 },
  amount: { fontFamily: fonts.monoMedium, fontSize: 14 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontFamily: fonts.monoMedium, fontSize: 9, letterSpacing: 1.3 },

  formPage: { flex: 1, paddingTop: 44 },
  formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  headAction: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  form: { paddingHorizontal: 12, paddingBottom: 32, gap: 12 },
  nameInput: { fontFamily: fonts.uiMedium, fontSize: 16, height: 54, borderRadius: 27, paddingHorizontal: 20 },
  wrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  strip: { flexGrow: 0, flexShrink: 0 },
  stripRow: { gap: 6, alignItems: 'center' },

  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 22, padding: 18, gap: 12 },
  toggleText: { flexShrink: 1, gap: 3 },
  switch: { width: 48, height: 28, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 999 },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
