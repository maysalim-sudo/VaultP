/**
 * People: who owes what.
 *
 * Two figures first, what you are owed and what you owe, then everyone on one
 * tile with their initials and a coloured, signed balance. The sign is never
 * alone: the words under it say the direction, because "-200" reads as either
 * the moment attention lapses.
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  formatAmount,
  type LedgerBalance,
  money,
  type Person,
  repaymentProgress,
  todayIn,
} from '@vaultp/core';

import { Empty, Figure, Initials, Label, PageHead, Row, Tile } from '../components/Industrial.js';
import { Screen } from '../components/Screen.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
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
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.body}>
          <PageHead title="People" action="Person" onAction={() => setAdding(true)} palette={palette} />

          <View style={styles.totals}>
            <Tile palette={palette} style={styles.total}>
              <Label palette={palette}>OWED TO YOU</Label>
              <Figure
                value={formatAmount(money(owedToYou, BASE_CURRENCY), { unit: 'none' })}
                size={30}
                colour={owedToYou > 0 ? palette.positive : palette.textFaint}
                palette={palette}
              />
            </Tile>
            <Tile palette={palette} style={styles.total}>
              <Label palette={palette}>YOU OWE</Label>
              <Figure
                value={formatAmount(money(youOwe, BASE_CURRENCY), { unit: 'none' })}
                size={30}
                colour={youOwe > 0 ? palette.accentText : palette.textFaint}
                palette={palette}
              />
            </Tile>
          </View>

          {people.length === 0 ? <Empty palette={palette}>NOBODY YET. ADD SOMEONE YOU LENT TO OR BORROWED FROM.</Empty> : null}

          {ordered.length > 0 ? (
            <View style={[styles.list, { backgroundColor: palette.surface }]}>
              {ordered.map((person, index) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  balance={balances.get(person.id)}
                  first={index === 0}
                  palette={palette}
                  onOpen={() => setOpenPerson(person)}
                />
              ))}
            </View>
          ) : null}

          <Pressable onPress={() => setShowArchived((current) => !current)} hitSlop={8} style={styles.archivedToggle}>
            <Label palette={palette} colour={palette.dim}>
              {showArchived ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}
            </Label>
          </Pressable>
          {showArchived && archived.length === 0 ? <Empty palette={palette}>NOBODY IS ARCHIVED</Empty> : null}
          {archived.length > 0 ? (
            <View style={[styles.list, { backgroundColor: palette.surface }]}>
              {archived.map((person, index) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  balance={undefined}
                  first={index === 0}
                  palette={palette}
                  onOpen={() => setOpenPerson(person)}
                />
              ))}
            </View>
          ) : null}
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

function PersonRow({
  person,
  balance,
  first,
  palette,
  onOpen,
}: {
  person: Person;
  balance: LedgerBalance | 'mixed' | undefined;
  first: boolean;
  palette: Palette;
  onOpen: () => void;
}) {
  const real = balance && balance !== 'mixed' ? balance : null;
  const net = real?.net.amountMinor ?? 0;
  const progress = real ? repaymentProgress(real) : null;
  const meta =
    balance === 'mixed'
      ? 'Mixed currencies: open to see'
      : progress
        ? `${formatAmount(money(progress.repaidMinor, real!.currency), { unit: 'none' })} of ${formatAmount(money(progress.lentMinor, real!.currency), { unit: 'none' })} repaid`
        : person.archived
          ? 'Archived'
          : balance
            ? 'Square'
            : 'Nothing recorded yet';

  return (
    <Row
      palette={palette}
      first={first}
      leading={<Initials name={person.name} palette={palette} />}
      title={person.name}
      meta={meta}
      dimmed={person.archived}
      onPress={onOpen}
      {...(real && net !== 0
        ? {
            value: `${net > 0 ? '+' : '−'}${formatAmount(money(Math.abs(net), real.currency), { unit: 'none' })}`,
            valueColour: net > 0 ? palette.positive : palette.accentText,
            unit: net > 0 ? 'OWES YOU' : 'YOU OWE',
          }
        : {})}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
  totals: { flexDirection: 'row', gap: 10 },
  total: { flex: 1, gap: 14 },
  list: { borderRadius: 22, paddingVertical: 6, overflow: 'hidden' },
  archivedToggle: { alignItems: 'center', paddingVertical: 12 },
});
