/**
 * Searching everything at once.
 *
 * You look for "Sami" or "insurance" without first deciding which module it was
 * filed under, which is the whole reason these things share an app. Opened over
 * whatever screen was showing, from the top bar; tapping a result opens the
 * thing itself.
 *
 * Results keep a fixed section order so the screen never rearranges itself as
 * you type, which makes a moving target of whatever you were about to tap.
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import {
  formatAmount,
  groupResults,
  searchEverything,
  type SearchResult,
  type SearchResultKind,
} from '@vaultp/core';

import { Disc, Empty, Label, Row } from '../components/Industrial.js';
import { Icon, type IconName } from '../components/icons.js';
import { fonts, paletteFor } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

const SECTION_LABELS: Record<SearchResultKind, string> = {
  person: 'PEOPLE',
  note: 'NOTES',
  expense: 'EXPENSES',
  debt: 'DEBTS',
  account: 'ACCOUNTS',
  document: 'DOCUMENTS',
};

const KIND_ICONS: Record<SearchResultKind, IconName> = {
  person: 'people',
  note: 'notes',
  expense: 'receipt',
  debt: 'money',
  account: 'bank',
  document: 'docs',
};

export function Search({
  onClose,
  onOpen,
}: {
  onClose?: () => void;
  onOpen?: (result: SearchResult) => void;
}) {
  const { vault, version } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const [term, setTerm] = useState('');

  const grouped = useMemo(
    () => groupResults(searchEverything(vault.db, term)),
    [vault, version, term],
  );
  const total = grouped.reduce((sum, group) => sum + group.results.length, 0);
  const searching = term.trim() !== '';

  return (
    <Screen onClose={onClose}>
      <View style={[styles.page, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={4}
              style={[styles.back, { borderColor: palette.border }]}
            >
              <Icon name="back" size={18} stroke={1.9} color={palette.text} />
            </Pressable>
          ) : null}
          <View style={[styles.field, { backgroundColor: palette.surface }]}>
            <Icon name="search" size={18} color={palette.dim} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              accessibilityLabel="Search everything"
              placeholder="Notes, money, people, documents"
              placeholderTextColor={palette.textFaint}
              autoFocus
              style={[styles.input, { color: palette.text }]}
            />
            {searching ? <Label palette={palette}>{total} FOUND</Label> : null}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {!searching ? (
            <Text style={[styles.hint, { color: palette.dim }]}>
              A person, a note, a merchant, an account, a policy number, including text inside a scanned document.
            </Text>
          ) : total === 0 ? (
            <Empty palette={palette}>NOTHING MATCHES</Empty>
          ) : null}

          {grouped.map((group) => (
            <View key={group.kind} style={[styles.group, { backgroundColor: palette.surface }]}>
              <View style={styles.groupHead}>
                <Label palette={palette}>
                  {SECTION_LABELS[group.kind]} · {group.results.length}
                </Label>
              </View>
              {group.results.map((result) => (
                <Row
                  key={`${result.kind}:${result.id}`}
                  palette={palette}
                  leading={<Disc icon={KIND_ICONS[result.kind]} size={36} palette={palette} />}
                  title={result.title}
                  {...(result.detail ? { meta: result.detail } : {})}
                  {...(result.amount ? { value: formatAmount(result.amount) } : {})}
                  {...(onOpen ? { onPress: () => onOpen(result) } : {})}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A modal draws from the very top, so it clears the status bar itself.
  page: { flex: 1, paddingTop: (StatusBar.currentHeight ?? 32) + 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 18, borderRadius: 26 },
  input: { flex: 1, fontFamily: fonts.uiMedium, fontSize: 16, padding: 0 },

  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  hint: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 21, padding: 8 },
  group: { borderRadius: 22, paddingVertical: 6, overflow: 'hidden' },
  groupHead: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
});
