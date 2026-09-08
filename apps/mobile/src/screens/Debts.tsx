/**
 * Who owes what.
 *
 * The list shows a net figure per person and its direction in words rather than a
 * sign, because "-200" is ambiguous the moment you stop concentrating: it reads as
 * either direction depending on which way round you were thinking. "You owe" and
 * "owes you" cannot be misread.
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

import { todayIn, toDecimalString, type LedgerBalance, type Person } from '@vaultp/core';

import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { PersonLedger } from './PersonLedger.js';

export function Debts({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [openPerson, setOpenPerson] = useState<Person | null>(null);

  const people = useMemo(() => vault.debts.listPeople(), [vault, version]);

  const balances = useMemo(() => {
    const byPerson = new Map<string, LedgerBalance>();
    for (const person of people) {
      // A ledger mixing currencies cannot be netted, and throwing here would take
      // the whole screen down over one bad row.
      try {
        const balance = vault.debts.ledgerFor(person.id, today);
        if (balance) byPerson.set(person.id, balance);
      } catch {
        // Shown as "mixed currencies" below rather than crashing the list.
      }
    }
    return byPerson;
  }, [vault, version, people, today]);

  const owedToMe = people.filter(
    (person) => (balances.get(person.id)?.net.amountMinor ?? 0) > 0,
  );
  const owedByMe = people.filter(
    (person) => (balances.get(person.id)?.net.amountMinor ?? 0) < 0,
  );
  const settled = people.filter(
    (person) => (balances.get(person.id)?.net.amountMinor ?? 0) === 0,
  );

  function addPerson() {
    if (name.trim() === '') return;
    mutate((v) => v.debts.addPerson({ name: name.trim() }));
    setName('');
    setAdding(false);
  }

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
          <Text style={[styles.headerTitle, { color: palette.text }]}>Debts</Text>
          <Pressable onPress={() => setAdding(true)} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>New</Text>
          </Pressable>
        </View>

        {adding ? (
          <View style={styles.addRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={palette.dim}
              autoFocus
              onSubmitEditing={addPerson}
              style={[
                styles.input,
                {
                  color: palette.text,
                  borderColor: palette.border,
                  backgroundColor: palette.surface,
                },
              ]}
            />
            <Pressable
              onPress={addPerson}
              style={[styles.addButton, { backgroundColor: palette.accent }]}
            >
              <Text style={styles.addButtonText}>Add</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.list}>
          {people.length === 0 ? (
            <Text style={[styles.empty, { color: palette.dim }]}>
              Nobody yet. Add someone you have lent money to, or borrowed from.
            </Text>
          ) : null}

          <Group
            title="Owes you"
            people={owedToMe}
            balances={balances}
            palette={palette}
            onOpen={setOpenPerson}
          />
          <Group
            title="You owe"
            people={owedByMe}
            balances={balances}
            palette={palette}
            onOpen={setOpenPerson}
          />
          <Group
            title="Settled"
            people={settled}
            balances={balances}
            palette={palette}
            onOpen={setOpenPerson}
          />
        </ScrollView>

        {openPerson ? (
          <PersonLedger person={openPerson} onClose={() => setOpenPerson(null)} />
        ) : null}
      </View>
    </Screen>
  );
}

function Group({
  title,
  people,
  balances,
  palette,
  onOpen,
}: {
  title: string;
  people: readonly Person[];
  balances: Map<string, LedgerBalance>;
  palette: Palette;
  onOpen: (person: Person) => void;
}) {
  if (people.length === 0) return null;

  return (
    <>
      <Text style={[styles.sectionLabel, { color: palette.dim }]}>{title}</Text>
      {people.map((person) => {
        const balance = balances.get(person.id);
        const net = balance?.net.amountMinor ?? 0;
        const interest = (balance?.owedToMe.interestMinor ?? 0) + (balance?.owedByMe.interestMinor ?? 0);

        return (
          <Pressable
            key={person.id}
            onPress={() => onOpen(person)}
            style={[styles.row, { borderBottomColor: palette.divider }]}
            android_ripple={{ color: palette.ripple }}
          >
            <View style={styles.rowMain}>
              <Text style={[styles.name, { color: palette.text }]}>{person.name}</Text>
              {!balance ? (
                <Text style={[styles.meta, { color: palette.dim }]}>
                  mixed currencies — open to see
                </Text>
              ) : interest > 0 ? (
                <Text style={[styles.meta, { color: palette.dim }]}>
                  includes {toDecimalString(balance.owedToMe.loans[0]?.loan.amount ?? balance.net)}{' '}
                  interest
                </Text>
              ) : null}
            </View>
            {balance ? (
              <Text
                style={[
                  styles.amount,
                  { color: net > 0 ? palette.success : net < 0 ? palette.danger : palette.dim },
                ]}
              >
                {toDecimalString(
                  net < 0 ? { ...balance.net, amountMinor: -net } : balance.net,
                )}{' '}
                {balance.currency}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </>
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

  addRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  addButton: { paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },
  addButtonText: { color: '#fff', fontWeight: '700' },

  list: { paddingHorizontal: 20, paddingBottom: 40 },
  empty: { textAlign: 'center', paddingVertical: 40, lineHeight: 20 },
  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowMain: { flexShrink: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 3 },
  amount: { fontWeight: '700' },
});
