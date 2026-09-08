/**
 * Recurring rules: the things you should never type twice.
 *
 * Rent every month, a subscription on its billing date. The engine that works out
 * when a rule fires, and the scheduler that logs it exactly once across two
 * devices, are already built and tested — this is the surface for them.
 *
 * Rules are paused, never deleted. Cancelling a subscription and deleting it are
 * different things: deleting it would erase the spending history that makes a
 * year-on-year comparison possible.
 */

import { useMemo, useState } from 'react';
import {
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
  exponentOf,
  money,
  nextOccurrenceOnOrAfter,
  todayIn,
  toDecimalString,
  type Category,
  type Frequency,
  type RecurringRule,
} from '@vaultp/core';

import { AmountDisplay, AmountPad } from '../components/AmountPad.js';
import {
  EMPTY_DRAFT,
  type Draft,
  draftToMinor,
  retypeForExponent,
} from '../components/amount.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

const CURRENCIES = [BASE_CURRENCY, 'USD', 'EUR'] as const;
const FREQUENCIES: ReadonlyArray<{ value: Frequency; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'daily', label: 'Daily' },
];

export function RecurringRules({
  categories,
  onClose,
}: {
  categories: readonly Category[];
  onClose?: () => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const [adding, setAdding] = useState(false);

  const rules = useMemo(() => vault.expenses.listRules(), [vault, version]);
  const active = rules.filter((rule) => rule.state === 'active');
  const inactive = rules.filter((rule) => rule.state !== 'active');

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
          <Text style={[styles.headerTitle, { color: palette.text }]}>Recurring</Text>
          <Pressable onPress={() => setAdding(true)} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>New</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {rules.length === 0 ? (
            <Text style={[styles.empty, { color: palette.dim }]}>
              Nothing recurring yet. Rent, a subscription — anything you would
              otherwise type every month.
            </Text>
          ) : null}

          {active.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              palette={palette}
              categories={categories}
              onPause={() => mutate((v) => v.expenses.setRuleState(rule.id, 'paused'))}
              onResume={() => mutate((v) => v.expenses.setRuleState(rule.id, 'active'))}
            />
          ))}

          {inactive.length > 0 ? (
            <Text style={[styles.sectionLabel, { color: palette.dim }]}>Paused</Text>
          ) : null}

          {inactive.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              palette={palette}
              categories={categories}
              onPause={() => mutate((v) => v.expenses.setRuleState(rule.id, 'paused'))}
              onResume={() => mutate((v) => v.expenses.setRuleState(rule.id, 'active'))}
            />
          ))}
        </ScrollView>

        {adding ? (
          <NewRuleForm
            categories={categories}
            palette={palette}
            onClose={() => setAdding(false)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function RuleRow({
  rule,
  palette,
  categories,
  onPause,
  onResume,
}: {
  rule: RecurringRule;
  palette: Palette;
  categories: readonly Category[];
  onPause: () => void;
  onResume: () => void;
}) {
  const paused = rule.state !== 'active';
  const category = categories.find((c) => c.id === rule.categoryId);
  const next = nextOccurrenceOnOrAfter(rule, todayIn());

  return (
    <View style={[styles.ruleRow, { borderBottomColor: palette.divider }]}>
      <View style={styles.ruleMain}>
        <Text style={[styles.ruleName, { color: paused ? palette.dim : palette.text }]}>
          {category?.icon ? `${category.icon}  ` : ''}
          {rule.name}
        </Text>
        <Text style={[styles.ruleMeta, { color: palette.dim }]}>
          {toDecimalString(rule.amount)} {rule.amount.currency}
          {'  ·  '}
          {paused ? 'paused' : `next ${next}`}
          {rule.autoLog && !paused ? '  ·  auto' : ''}
        </Text>
      </View>
      <Pressable
        onPress={paused ? onResume : onPause}
        style={[styles.ruleAction, { borderColor: palette.border }]}
        hitSlop={8}
      >
        <Text style={{ color: paused ? palette.success : palette.dim, fontWeight: '600' }}>
          {paused ? 'Resume' : 'Pause'}
        </Text>
      </Pressable>
    </View>
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
   * The anchor sets the day the rule fires. For a monthly rule that day matters —
   * rent on the 1st, a subscription on the 15th — so it is chosen directly rather
   * than inferred from whenever the rule happened to be created.
   */
  const anchorDate =
    frequency === 'monthly'
      ? `${today.slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`
      : today;

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
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.dim }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.text }]}>New rule</Text>
          <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
            <Text
              style={[styles.headerAction, { color: canSave ? palette.accent : palette.dim }]}
            >
              Save
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Rent, Claude, gym…"
            placeholderTextColor={palette.dim}
            style={[
              styles.nameInput,
              { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface },
            ]}
          />

          <AmountDisplay draft={draft} currency={currency} palette={palette} />

          <View style={styles.row}>
            {CURRENCIES.map((code) => (
              <Chip
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

          <View style={styles.row}>
            {FREQUENCIES.map((option) => (
              <Chip
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
              <Text style={[styles.label, { color: palette.dim }]}>Day of the month</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.dayRow}
                contentContainerStyle={styles.days}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <Chip
                    key={day}
                    label={String(day)}
                    selected={dayOfMonth === day}
                    palette={palette}
                    onPress={() => setDayOfMonth(day)}
                  />
                ))}
              </ScrollView>
              {dayOfMonth > 28 ? (
                // The engine clamps and returns to the chosen day next month; say so,
                // because "31st" silently becoming "28th" forever is the bug people
                // expect here.
                <Text style={[styles.hint, { color: palette.dim }]}>
                  Short months use their last day, then it returns to the {dayOfMonth}
                  {'th'}.
                </Text>
              ) : null}
            </>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dayRow}
            contentContainerStyle={styles.days}
          >
            {categories.map((category) => (
              <Chip
                key={category.id}
                label={`${category.icon ?? ''} ${category.name}`}
                selected={categoryId === category.id}
                palette={palette}
                colour={category.color ?? undefined}
                onPress={() => setCategoryId(categoryId === category.id ? null : category.id)}
              />
            ))}
          </ScrollView>

          <Pressable
            onPress={() => setAutoLog((current) => !current)}
            style={[styles.toggle, { borderColor: palette.border, backgroundColor: palette.surface }]}
          >
            <View style={styles.toggleText}>
              <Text style={{ color: palette.text, fontWeight: '600' }}>
                {autoLog ? 'Log it automatically' : 'Just remind me'}
              </Text>
              <Text style={{ color: palette.dim, fontSize: 12, marginTop: 2 }}>
                {autoLog
                  ? 'The expense appears on its own, on the day it is due.'
                  : 'It waits for you to confirm the amount before being logged.'}
              </Text>
            </View>
            <View
              style={[
                styles.switch,
                { backgroundColor: autoLog ? palette.accent : palette.key },
              ]}
            >
              <View style={[styles.knob, autoLog ? styles.knobOn : styles.knobOff]} />
            </View>
          </Pressable>

          <AmountPad
            draft={draft}
            exponent={exponent}
            onChange={setDraft}
            palette={palette}
          />
        </ScrollView>
      </View>
    </Screen>
  );
}

function Chip({
  label,
  selected,
  palette,
  colour,
  onPress,
}: {
  label: string;
  selected: boolean;
  palette: Palette;
  colour?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: palette.border, backgroundColor: palette.surface },
        selected ? { backgroundColor: colour ?? palette.accent, borderColor: 'transparent' } : null,
      ]}
    >
      <Text style={{ color: selected ? '#fff' : palette.text, fontWeight: '600' }}>
        {label}
      </Text>
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
  },
  headerTitle: { fontWeight: '700', fontSize: 17 },
  headerAction: { fontSize: 16, fontWeight: '600' },

  list: { paddingHorizontal: 20, paddingBottom: 40 },
  empty: { textAlign: 'center', paddingVertical: 40, lineHeight: 20 },
  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 4,
  },

  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  ruleMain: { flexShrink: 1 },
  ruleName: { fontSize: 16, fontWeight: '600' },
  ruleMeta: { fontSize: 12, marginTop: 3 },
  ruleAction: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },

  form: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  nameInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  hint: { fontSize: 12, marginTop: -6 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  dayRow: { flexGrow: 0, flexShrink: 0 },
  days: { gap: 8, paddingRight: 20, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  toggleText: { flexShrink: 1 },
  switch: { width: 48, height: 28, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 999, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
