/**
 * One person's ledger, told as a story.
 *
 * The page answers one question first — where do we stand? — with the balance
 * as the hero, its direction in words, and a bar for how much has already come
 * back. Below it, the action you most likely came to take is the big button: if
 * they owe you, "They paid me"; if you owe them, "I paid them". Adding to the
 * debt is beside it, and the rarer moves (the other direction, settling up) are
 * one tap away rather than four equal buttons asking to be misread.
 *
 * Still four distinct actions underneath, never a direction toggle: "I lent them"
 * and "they paid me back" cannot be confused, and a toggle is exactly the
 * control people get backwards.
 *
 * The history is the audit trail, as a timeline by month. Nothing here edits a
 * past row: holding an entry offers to void it, or to correct it — the right
 * one is recorded and the old one voided, both visible.
 */

import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  type DebtEntry,
  formatAmount,
  type LedgerBalance,
  money,
  type Person,
  repaymentProgress,
  spacing,
  todayIn,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { describeDate } from '../components/DateField.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import { Button, Cells, Figure, Initials, Label, Tile } from '../components/Industrial.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { Glyph, Icon } from '../components/icons.js';

type Action = 'lend' | 'borrow' | 'repaid_to_me' | 'repaid_by_me';

const ACTIONS: Record<Action, { label: string; hint: string }> = {
  lend: { label: 'I lent them', hint: 'Money you gave them.' },
  borrow: { label: 'I borrowed', hint: 'Money they gave you.' },
  repaid_to_me: { label: 'They paid me', hint: 'A repayment you received.' },
  repaid_by_me: { label: 'I paid them', hint: 'A repayment you made.' },
};

export function PersonLedger({ person: opened, onClose }: { person: Person; onClose: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  // Read fresh, so a rename shows at once; the one passed in is the fallback.
  const person = useMemo(() => vault.debts.getPerson(opened.id) ?? opened, [vault, version, opened]);

  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);
  /** An entry being re-recorded: the original is voided once the new one lands. */
  const [correcting, setCorrecting] = useState<DebtEntry | null>(null);

  function entryOptions(entry: DebtEntry) {
    if (entry.kind !== 'loan' && entry.kind !== 'payment') return;
    Alert.alert(
      describeEntry(entry),
      `${formatAmount(entry.amount)} on ${entry.occurredOn}. ` +
        'Past entries are never changed in place: a correction records the right one and voids this, and both stay in the history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: () => mutate((v) => v.debts.voidEntry(entry.id, 'Voided on the phone')),
        },
        { text: 'Correct amount', onPress: () => setCorrecting(entry) },
      ],
    );
  }

  function saveCorrection(entry: DebtEntry, minor: number, currency: string) {
    setCorrecting(null);
    if (minor <= 0) return;
    const input = {
      personId: person.id,
      amount: money(minor, currency),
      occurredOn: entry.occurredOn,
      ...(entry.note ? { note: entry.note } : {}),
    };
    mutate((v) => {
      // Recorded first, so nothing is voided unless its replacement exists.
      if (entry.kind === 'loan') {
        const terms = entry.terms.method === 'none' ? {} : { interest: entry.terms };
        if (entry.direction === 'owed_to_me') v.debts.lend({ ...input, ...terms });
        else v.debts.borrow({ ...input, ...terms });
      } else if (entry.direction === 'owed_to_me') {
        v.debts.recordRepaymentToMe(input);
      } else {
        v.debts.recordRepaymentByMe(input);
      }
      return v.debts.voidEntry(entry.id, 'Corrected on the phone');
    });
  }

  const entries = useMemo(() => [...vault.debts.entriesFor(person.id)].reverse(), [vault, version, person.id]);

  const balance = useMemo<LedgerBalance | undefined>(() => {
    try {
      return vault.debts.ledgerFor(person.id, today);
    } catch {
      return undefined;
    }
  }, [vault, version, person.id, today]);
  const mixed = entries.length > 0 && !balance;

  const net = balance?.net.amountMinor ?? 0;
  const interest = (balance?.owedToMe.interestMinor ?? 0) + (balance?.owedByMe.interestMinor ?? 0);
  const progress = balance ? repaymentProgress(balance) : null;
  const tone = net > 0 ? palette.positive : net < 0 ? palette.accentText : palette.dim;

  // The likely next move is the big button; its opposite sits beside it.
  const primary: Action = net < 0 ? 'repaid_by_me' : net > 0 ? 'repaid_to_me' : 'lend';
  const secondary: Action = net < 0 ? 'borrow' : net > 0 ? 'lend' : 'borrow';
  const rest = (Object.keys(ACTIONS) as Action[]).filter((key) => key !== primary && key !== secondary);

  const months = useMemo(() => groupByMonth(entries), [entries]);

  function record(kind: Action, minor: number, currency: string) {
    if (minor <= 0) return;
    const input = { personId: person.id, amount: money(minor, currency), occurredOn: today };
    mutate((v) => {
      switch (kind) {
        case 'lend':
          return v.debts.lend(input);
        case 'borrow':
          return v.debts.borrow(input);
        case 'repaid_to_me':
          return v.debts.recordRepaymentToMe(input);
        case 'repaid_by_me':
          return v.debts.recordRepaymentByMe(input);
      }
    });
    setAction(null);
  }

  function settle() {
    Alert.alert(
      'Settle up?',
      `Records that ${person.name} and you are square as of today, and stops any interest. ` +
        `The history stays — this is the receipt, not an erasure.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settle', onPress: () => mutate((v) => v.debts.settle(person.id, today)) },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={4}
            style={({ pressed }) => [styles.back, { borderColor: palette.border }, pressed ? styles.pressed : null]}
          >
            <Icon name="back" size={18} stroke={1.9} color={palette.text} />
          </Pressable>
          <Initials name={person.name} size={36} palette={palette} />
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {person.name}
          </Text>
          <View style={styles.headerSpacer} />
          <Pressable
            onPress={() => setEditing(true)}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => [styles.editButton, { borderColor: palette.border }, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.editText, { color: palette.text }]}>Edit</Text>
          </Pressable>
        </View>
        {person.contact || person.note || person.archived ? (
          <Text style={[styles.details, { color: palette.dim }]} numberOfLines={2}>
            {[person.archived ? 'Archived' : null, person.contact, person.note].filter(Boolean).join('  ·  ')}
          </Text>
        ) : null}

        <ScrollView contentContainerStyle={styles.body}>
          {/* Where we stand. */}
          {mixed ? (
            <Text style={[styles.mixed, { color: palette.accentText }]}>
              This ledger mixes currencies, so it cannot be netted into one figure. Converting a debt at
              today's rate would change what is owed.
            </Text>
          ) : (
            <Tile palette={palette}>
              <Label palette={palette}>
                {(net > 0 ? `${person.name} owes you` : net < 0 ? `You owe ${person.name}` : 'You are square').toUpperCase()}
              </Label>
              {net !== 0 && balance ? (
                <Figure
                  value={formatAmount(money(Math.abs(net), balance.currency), { unit: 'none' })}
                  unit={balance.currency}
                  size={48}
                  colour={tone}
                  palette={palette}
                />
              ) : null}
              {progress && balance ? (
                <>
                  <View style={styles.cells}>
                    <Cells ratio={progress.ratio} count={20} height={18} colour={tone} palette={palette} />
                  </View>
                  <Text style={[styles.caption, { color: palette.dim }]}>
                    {formatAmount(money(progress.repaidMinor, balance.currency), { unit: 'none' })} OF{' '}
                    {formatAmount(money(progress.lentMinor, balance.currency), { unit: 'none' })} REPAID
                  </Text>
                </>
              ) : null}
              {interest > 0 && balance ? (
                <Text style={[styles.caption, { color: palette.dim }]}>
                  INCLUDES {formatAmount(money(interest, balance.currency), { unit: 'none' })} INTEREST TO TODAY
                </Text>
              ) : null}
            </Tile>
          )}

          {/* What to do next. */}
          <View style={styles.buttons}>
            <View style={styles.primary}>
              <Button label={ACTIONS[primary].label} palette={palette} onPress={() => setAction(primary)} />
            </View>
            <View style={styles.secondary}>
              <Button
                label={net > 0 ? 'Lend more' : net < 0 ? 'Borrow more' : ACTIONS[secondary].label}
                tone="outline"
                palette={palette}
                onPress={() => setAction(secondary)}
              />
            </View>
          </View>
          <View style={styles.links}>
            {rest.map((key) => (
              <Pressable key={key} onPress={() => setAction(key)} hitSlop={6}>
                <Text style={[styles.link, { color: palette.accentText }]}>{ACTIONS[key].label}</Text>
              </Pressable>
            ))}
            {net !== 0 ? (
              <Pressable onPress={settle} hitSlop={6}>
                <Text style={[styles.link, { color: palette.accentText }]}>Settle up</Text>
              </Pressable>
            ) : null}
          </View>

          {/* The story so far. */}
          {entries.length === 0 ? (
            <Text style={[styles.empty, { color: palette.dim }]}>
              Nothing recorded with {person.name} yet. Lend or borrow to start their ledger.
            </Text>
          ) : (
            months.map(({ label, items }) => (
              <View key={label} style={[styles.monthTile, { backgroundColor: palette.surface }]}>
                <View style={styles.month}>
                  <Label palette={palette}>{label.toUpperCase()}</Label>
                </View>
                {items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} palette={palette} onLongPress={() => entryOptions(entry)} />
                ))}
              </View>
            ))
          )}
        </ScrollView>

        {action ? (
          <AmountSheet
            title={ACTIONS[action].label}
            hint={ACTIONS[action].hint}
            allowCurrencyChange
            confirmLabel="Record"
            onCancel={() => setAction(null)}
            onSave={(minor, currency) => record(action, minor, currency)}
          />
        ) : null}

        {correcting ? (
          <AmountSheet
            title={`Correct: ${describeEntry(correcting)}`}
            hint="The right amount. The old entry is voided and kept in the history."
            initialMinor={correcting.amount.amountMinor}
            currency={correcting.amount.currency}
            allowCurrencyChange
            confirmLabel="Correct"
            onCancel={() => setCorrecting(null)}
            onSave={(minor, currency) => saveCorrection(correcting, minor, currency)}
          />
        ) : null}

        {editing ? (
          <FieldsSheet
            title="Edit details"
            palette={palette}
            fields={[
              { key: 'name', label: 'Name', initial: person.name, required: true },
              { key: 'contact', label: 'Contact', initial: person.contact ?? '', placeholder: 'Phone, email, anything', keyboard: 'default' },
              { key: 'note', label: 'Note', initial: person.note ?? '' },
            ]}
            footnote="Their loans and repayments stay exactly as they are."
            actions={[
              {
                label: person.archived ? 'Unarchive' : 'Archive',
                onPress: () => {
                  setEditing(false);
                  mutate((v) => (person.archived ? v.debts.unarchivePerson(person.id) : v.debts.archivePerson(person.id)));
                },
              },
            ]}
            onCancel={() => setEditing(false)}
            onSave={(values) => {
              setEditing(false);
              mutate((v) =>
                v.debts.updatePerson(person.id, {
                  name: values.name ?? person.name,
                  contact: values.contact ?? null,
                  note: values.note ?? null,
                }),
              );
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function describeEntry(entry: DebtEntry): string {
  if (entry.kind === 'loan') return entry.direction === 'owed_to_me' ? 'You lent' : 'You borrowed';
  if (entry.kind === 'payment') return entry.direction === 'owed_to_me' ? 'They paid you' : 'You paid them';
  return entry.kind === 'settlement' ? 'Settled up' : 'Correction';
}

function groupByMonth(entries: readonly DebtEntry[]): { label: string; items: DebtEntry[] }[] {
  const groups: { label: string; items: DebtEntry[] }[] = [];
  for (const entry of entries) {
    const [y, m] = entry.occurredOn.split('-').map(Number) as [number, number];
    const label = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}

function EntryRow({
  entry,
  palette,
  onLongPress,
}: {
  entry: DebtEntry;
  palette: Palette;
  onLongPress: () => void;
}) {
  // Money that left you goes up and away; money that came back comes down.
  const { text, glyph, colour } =
    entry.kind === 'settlement'
      ? { text: 'Settled up', glyph: '✓', colour: palette.dim }
      : entry.kind === 'adjustment'
        ? { text: 'Correction', glyph: '±', colour: palette.dim }
        : entry.kind === 'loan'
          ? entry.direction === 'owed_to_me'
            ? { text: 'You lent', glyph: '↗', colour: palette.accentText }
            : { text: 'You borrowed', glyph: '↙', colour: palette.positive }
          : entry.direction === 'owed_to_me'
            ? { text: 'They paid you', glyph: '↙', colour: palette.positive }
            : { text: 'You paid them', glyph: '↗', colour: palette.accentText };

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.entry,
        { borderTopWidth: 1, borderTopColor: palette.border },
        pressed ? { backgroundColor: palette.key } : null,
      ]}
    >
      <View style={[styles.dot, { borderColor: colour }]}>
        <Glyph glyph={glyph} color={colour} size={14} />
      </View>
      <View style={styles.entryMain}>
        <Text style={[styles.entryTitle, { color: palette.text }]}>{text}</Text>
        <Text style={[styles.entryMeta, { color: palette.dim }]} numberOfLines={2}>
          {describeDate(entry.occurredOn)}
          {entry.note ? `  ·  ${entry.note}` : ''}
          {entry.terms.method !== 'none' ? `  ·  ${(entry.terms.rate * 100).toFixed(1)}% ${entry.terms.period}` : ''}
        </Text>
      </View>
      <Text style={[styles.entryAmount, { color: palette.text }]}>
        {formatAmount(entry.amount)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 44 },
  pressed: { transform: [{ scale: 0.97 }] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 12, paddingBottom: spacing.md },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.uiSemibold, fontSize: 20, letterSpacing: -0.4, flexShrink: 1 },
  headerSpacer: { flex: 1 },
  editButton: { height: 40, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, justifyContent: 'center' },
  editText: { fontFamily: fonts.uiSemibold, fontSize: 13 },
  details: { fontFamily: fonts.ui, fontSize: 13, paddingHorizontal: 16, paddingBottom: spacing.sm },

  body: { paddingHorizontal: 12, paddingBottom: 40 },
  cells: { flexDirection: 'row' },
  caption: { fontFamily: fonts.mono, fontSize: 11 },
  mixed: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 21, padding: 8 },

  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: 10 },
  primary: { flex: 1.3 },
  secondary: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md },
  link: { fontFamily: fonts.uiSemibold, fontSize: 13 },

  empty: { fontFamily: fonts.ui, textAlign: 'center', marginTop: 48, lineHeight: 21 },
  monthTile: { borderRadius: 22, marginTop: 10, overflow: 'hidden' },
  month: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingVertical: 10, paddingHorizontal: 18 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  entryMain: { flex: 1, minWidth: 0 },
  entryTitle: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  entryMeta: { fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  entryAmount: { fontFamily: fonts.monoMedium, fontSize: 13 },
});