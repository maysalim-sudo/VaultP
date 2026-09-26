/**
 * One person's ledger.
 *
 * Four actions rather than a direction toggle, because a toggle is exactly the
 * control people get backwards. "I lent them" and "they paid me back" cannot be
 * confused; "direction: owed_to_me" absolutely can.
 *
 * The entry list is the audit trail. Nothing here edits a past row: a mistake is
 * corrected by a visible adjustment, so the ledger shows that something changed
 * and when.
 */

import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import {
  money,
  todayIn,
  toDecimalString,
  type DebtEntry,
  type LedgerBalance,
  type Person,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';

type Action = 'lend' | 'borrow' | 'repaid_to_me' | 'repaid_by_me';

const ACTIONS: ReadonlyArray<{ key: Action; label: string; hint: string }> = [
  { key: 'lend', label: 'I lent them', hint: 'Money you gave them.' },
  { key: 'borrow', label: 'I borrowed', hint: 'Money they gave you.' },
  { key: 'repaid_to_me', label: 'They paid me', hint: 'A repayment you received.' },
  { key: 'repaid_by_me', label: 'I paid them', hint: 'A repayment you made.' },
];

export function PersonLedger({
  person,
  onClose,
}: {
  person: Person;
  onClose: () => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [action, setAction] = useState<Action | null>(null);

  const entries = useMemo(
    () => [...vault.debts.entriesFor(person.id)].reverse(),
    [vault, version, person.id],
  );

  const balance = useMemo<LedgerBalance | undefined>(() => {
    try {
      return vault.debts.ledgerFor(person.id, today);
    } catch {
      return undefined;
    }
  }, [vault, version, person.id, today]);

  const net = balance?.net.amountMinor ?? 0;
  const interest =
    (balance?.owedToMe.interestMinor ?? 0) + (balance?.owedByMe.interestMinor ?? 0);

  function record(kind: Action, minor: number, currency: string) {
    if (minor <= 0) return;
    const amount = money(minor, currency);

    mutate((v) => {
      switch (kind) {
        case 'lend':
          return v.debts.lend({ personId: person.id, amount, occurredOn: today });
        case 'borrow':
          return v.debts.borrow({ personId: person.id, amount, occurredOn: today });
        case 'repaid_to_me':
          return v.debts.recordRepaymentToMe({
            personId: person.id,
            amount,
            occurredOn: today,
          });
        case 'repaid_by_me':
          return v.debts.recordRepaymentByMe({
            personId: person.id,
            amount,
            occurredOn: today,
          });
      }
    });
    setAction(null);
  }

  function settle() {
    Alert.alert(
      'Settle up?',
      `Records that ${person.name} and you are square as of today, and stops any ` +
        `interest. The history stays — this is the receipt, not an erasure.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Settle',
          style: 'destructive',
          onPress: () => {
            mutate((v) => v.debts.settle(person.id, today));
          },
        },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.dim }]}>Back</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
            {person.name}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.balanceBlock}>
            {balance ? (
              <>
                <Text style={[styles.balanceLabel, { color: palette.dim }]}>
                  {net > 0 ? 'Owes you' : net < 0 ? 'You owe' : 'Settled up'}
                </Text>
                {net !== 0 ? (
                  <Text
                    style={[
                      styles.balance,
                      { color: net > 0 ? palette.positive : palette.negative },
                    ]}
                  >
                    {toDecimalString(money(Math.abs(net), balance.currency))}{' '}
                    {balance.currency}
                  </Text>
                ) : null}
                {interest > 0 ? (
                  <Text style={[styles.note, { color: palette.dim }]}>
                    includes {toDecimalString(money(interest, balance.currency))} interest
                    accrued to today
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={[styles.note, { color: palette.warning }]}>
                This ledger mixes currencies, so it cannot be netted into one figure.
                Converting a debt at today's rate would change what is owed.
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            {ACTIONS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setAction(option.key)}
                style={[
                  styles.actionButton,
                  { borderColor: palette.border, backgroundColor: palette.surface },
                ]}
              >
                <Text style={{ color: palette.text, fontWeight: '600' }}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {net !== 0 ? (
            <Pressable onPress={settle} style={styles.settle}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>Settle up</Text>
            </Pressable>
          ) : null}

          <Text style={[styles.sectionLabel, { color: palette.dim }]}>History</Text>
          {entries.length === 0 ? (
            <Text style={[styles.note, { color: palette.dim }]}>Nothing recorded yet.</Text>
          ) : (
            entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} palette={palette} />
            ))
          )}
        </ScrollView>

        {action ? (
          <AmountSheet
            title={ACTIONS.find((option) => option.key === action)!.label}
            hint={ACTIONS.find((option) => option.key === action)!.hint}
            allowCurrencyChange
            confirmLabel="Record"
            onCancel={() => setAction(null)}
            onSave={(minor, currency) => record(action, minor, currency)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function EntryRow({ entry, palette }: { entry: DebtEntry; palette: Palette }) {
  const description =
    entry.kind === 'settlement'
      ? 'Settled up'
      : entry.kind === 'adjustment'
        ? 'Correction'
        : entry.kind === 'loan'
          ? entry.direction === 'owed_to_me'
            ? 'You lent'
            : 'You borrowed'
          : entry.direction === 'owed_to_me'
            ? 'They paid you'
            : 'You paid them';

  return (
    <View style={[styles.entry, { borderBottomColor: palette.divider }]}>
      <View style={styles.entryMain}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>{description}</Text>
        <Text style={[styles.note, { color: palette.dim }]}>
          {entry.occurredOn}
          {entry.note ? `  ·  ${entry.note}` : ''}
          {entry.terms.method !== 'none'
            ? `  ·  ${(entry.terms.rate * 100).toFixed(1)}% ${entry.terms.period}`
            : ''}
        </Text>
      </View>
      <Text style={{ color: palette.text }}>
        {toDecimalString(entry.amount)} {entry.amount.currency}
      </Text>
    </View>
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
  headerTitle: { fontWeight: '700', fontSize: 17, flexShrink: 1, textAlign: 'center' },
  headerAction: { fontSize: 16, fontWeight: '600' },
  headerSpacer: { width: 44 },

  body: { paddingHorizontal: 20, paddingBottom: 48 },
  balanceBlock: { paddingVertical: 12 },
  balanceLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  balance: { fontSize: 34, fontWeight: '700', marginTop: 4 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 4 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexGrow: 1,
    alignItems: 'center',
  },
  settle: { alignItems: 'center', paddingVertical: 16 },

  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 4,
  },
  entry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  entryMain: { flexShrink: 1 },
});
