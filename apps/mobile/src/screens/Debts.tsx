/**
 * Who owes what.
 *
 * Two figures first — what is owed to you, what you owe — then the people, each
 * a card with their balance in words and how far it has been paid down. A net
 * figure is never shown as a signed number: "-200" reads as either direction
 * the moment attention lapses, and "owes you" / "you owe" cannot be misread.
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  formatAmount,
  type LedgerBalance,
  money,
  type Person,
  radii,
  repaymentProgress,
  spacing,
  todayIn,
  typeScale,
} from '@vaultp/core';

import { Avatar } from '../components/Avatar.js';
import { Screen } from '../components/Screen.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { Icon } from '../components/icons.js';
import { paletteFor, type Palette } from '../components/theme.js';
import type { IntentProps } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { PersonLedger } from './PersonLedger.js';

export function Debts({ onClose, intent, onIntentHandled }: { onClose?: () => void } & IntentProps) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [adding, setAdding] = useState(false);
  const [openPerson, setOpenPerson] = useState<Person | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Arriving from search or Home: open that person, or start a new one.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === 'person') {
      const person = vault.debts.getPerson(intent.id);
      if (person) setOpenPerson(person);
    }
    if (intent.kind === 'newPerson') setAdding(true);
    onIntentHandled?.();
  }, [intent, vault, onIntentHandled]);

  const people = useMemo(() => vault.debts.listPeople(), [vault, version]);
  const archived = useMemo(
    () => (showArchived ? vault.debts.listPeople(true).filter((person) => person.archived) : []),
    [vault, version, showArchived],
  );

  const balances = useMemo(() => {
    const byPerson = new Map<string, LedgerBalance | 'mixed'>();
    for (const person of people) {
      // A ledger mixing currencies cannot be netted; it must not take the list down.
      try {
        const balance = vault.debts.ledgerFor(person.id, today);
        if (balance) byPerson.set(person.id, balance);
      } catch {
        byPerson.set(person.id, 'mixed');
      }
    }
    return byPerson;
  }, [vault, version, people, today]);

  const netOf = (person: Person) => {
    const balance = balances.get(person.id);
    return balance && balance !== 'mixed' ? balance.net.amountMinor : 0;
  };

  // Owed to you first, then what you owe, then the square and the mixed; the
  // largest amounts at the top of each.
  const ordered = [...people].sort((a, b) => {
    const rank = (n: number) => (n > 0 ? 0 : n < 0 ? 1 : 2);
    return rank(netOf(a)) - rank(netOf(b)) || Math.abs(netOf(b)) - Math.abs(netOf(a));
  });

  // Totals in the base currency only: adding dinars to euros would be a number
  // that means nothing.
  let owedToYou = 0;
  let youOwe = 0;
  for (const balance of balances.values()) {
    if (balance === 'mixed' || balance.currency !== BASE_CURRENCY) continue;
    if (balance.net.amountMinor > 0) owedToYou += balance.net.amountMinor;
    else youOwe -= balance.net.amountMinor;
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.dim }]}>←</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.title, { color: palette.text }]}>Debts</Text>
          <Pressable
            onPress={() => setAdding(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.newButton, { backgroundColor: palette.key }, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.newText, { color: palette.text }]}>＋ Person</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.totals}>
            <Total label="Owed to you" minor={owedToYou} colour={palette.positive} palette={palette} />
            <Total label="You owe" minor={youOwe} colour={palette.negative} palette={palette} />
          </View>

          {people.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="people" size={52} color={palette.textFaint} />
              <Text style={[styles.emptyText, { color: palette.dim }]}>
                Nobody yet. Add someone you have lent money to, or borrowed from — or record it straight from the ＋
                on the home screen.
              </Text>
            </View>
          ) : null}

          {ordered.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              balance={balances.get(person.id)}
              palette={palette}
              onOpen={() => setOpenPerson(person)}
            />
          ))}

          <Pressable onPress={() => setShowArchived((current) => !current)} hitSlop={8} style={styles.archivedToggle}>
            <Text style={{ color: palette.dim }}>
              {showArchived ? 'Hide archived people' : 'Show archived people'}
            </Text>
          </Pressable>
          {showArchived && archived.length === 0 ? (
            <Text style={{ color: palette.dim, textAlign: 'center' }}>Nobody is archived.</Text>
          ) : null}
          {archived.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              balance={undefined}
              palette={palette}
              onOpen={() => setOpenPerson(person)}
            />
          ))}
        </ScrollView>

        {adding ? (
          <TextPrompt
            title="Someone new"
            placeholder="Their name"
            action="Add"
            palette={palette}
            onCancel={() => setAdding(false)}
            onSave={(name) => {
              const created = mutate((v) => v.debts.addPerson({ name }));
              setAdding(false);
              if (created) setOpenPerson(created);
            }}
          />
        ) : null}

        {openPerson ? <PersonLedger person={openPerson} onClose={() => setOpenPerson(null)} /> : null}
      </View>
    </Screen>
  );
}

function Total({ label, minor, colour, palette }: { label: string; minor: number; colour: string; palette: Palette }) {
  return (
    <View style={[styles.total, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.totalLabel, { color: palette.dim }]}>{label}</Text>
      <Text style={[styles.totalValue, { color: minor > 0 ? colour : palette.dim }]}>
        {formatAmount(money(minor, BASE_CURRENCY), { unit: 'none' })}
        <Text style={[styles.totalUnit, { color: palette.dim }]}> {BASE_CURRENCY}</Text>
      </Text>
    </View>
  );
}

function PersonCard({
  person,
  balance,
  palette,
  onOpen,
}: {
  person: Person;
  balance: LedgerBalance | 'mixed' | undefined;
  palette: Palette;
  onOpen: () => void;
}) {
  const real = balance && balance !== 'mixed' ? balance : null;
  const net = real?.net.amountMinor ?? 0;
  const tone = net > 0 ? palette.positive : net < 0 ? palette.negative : palette.dim;
  const progress = real ? repaymentProgress(real) : null;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        net === 0 ? styles.square : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Avatar id={person.id} name={person.name} size={42} />
      <View style={styles.cardMain}>
        <View style={styles.cardTop}>
          <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
            {person.name}
          </Text>
          {real && net !== 0 ? (
            <Text style={[styles.cardAmount, { color: tone }]}>
              {formatAmount(money(Math.abs(net), real.currency))}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.cardSub, { color: balance === 'mixed' ? palette.warning : palette.dim }]}>
          {balance === 'mixed'
            ? 'mixed currencies — open to see'
            : net > 0
              ? 'owes you'
              : net < 0
                ? 'you owe'
                : balance
                  ? 'square'
                  : 'nothing recorded yet'}
          {progress ? `  ·  ${Math.round(progress.ratio * 100)}% paid back` : ''}
        </Text>
        {progress ? (
          <View style={[styles.track, { backgroundColor: palette.key }]}>
            <View style={[styles.fill, { width: `${Math.round(progress.ratio * 100)}%`, backgroundColor: tone }]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 4 },
  pressed: { transform: [{ scale: 0.97 }] },
  archivedToggle: { alignItems: 'center', paddingVertical: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerAction: { fontSize: 24, fontWeight: '600' },
  title: { flex: 1, fontSize: typeScale.xl, fontWeight: '700', letterSpacing: -0.5 },
  newButton: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill },
  newText: { fontSize: typeScale.sm, fontWeight: '700' },

  body: { paddingHorizontal: spacing.lg, paddingBottom: 56, gap: spacing.sm },
  totals: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  total: { flex: 1, borderRadius: radii.lg, borderWidth: 1, padding: spacing.lg },
  totalLabel: { fontSize: typeScale.xs, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  totalValue: { fontSize: typeScale.lg, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  totalUnit: { fontSize: typeScale.sm, fontWeight: '600' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  square: { opacity: 0.7 },
  cardMain: { flex: 1, gap: 3 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  cardName: { fontSize: typeScale.md, fontWeight: '600', flexShrink: 1 },
  cardAmount: { fontSize: typeScale.md, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardSub: { fontSize: typeScale.xs },
  track: { height: 5, borderRadius: radii.pill, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: radii.pill },

  empty: { alignItems: 'center', paddingTop: 60, gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 56, opacity: 0.4 },
  emptyText: { fontSize: typeScale.base, textAlign: 'center', lineHeight: 21 },
});
