/**
 * Searching everything at once.
 *
 * You look for "Sami" or "insurance" without first deciding which module it was
 * filed under — which is the whole reason these four things share an app rather
 * than being four apps.
 *
 * Results keep a fixed section order so the screen never rearranges itself as you
 * type, which makes a moving target of whatever you were about to tap.
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
  formatAmount,
  groupResults,
  searchEverything,
  type SearchResult,
  type SearchResultKind,
} from '@vaultp/core';

import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

const SECTION_LABELS: Record<SearchResultKind, string> = {
  person: 'People',
  note: 'Notes',
  expense: 'Expenses',
  debt: 'Debts',
  account: 'Accounts',
  document: 'Documents',
};

/**
 * Opened over whatever screen was showing, from the 🔎 in the drawer or the
 * bar on Home. Tapping a result opens that thing itself.
 */
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

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder="Search everything"
            placeholderTextColor={palette.dim}
            autoFocus
            style={[
              styles.input,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.cancel, { color: palette.dim }]}>Close</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {term.trim() === '' ? (
            <Text style={[styles.hint, { color: palette.dim }]}>
              A person, a note, a merchant, an account, a policy number — including
              text inside a scanned document.
            </Text>
          ) : total === 0 ? (
            <Text style={[styles.hint, { color: palette.dim }]}>
              Nothing matches “{term.trim()}”.
            </Text>
          ) : null}

          {grouped.map((group) => (
            <View key={group.kind}>
              <Text style={[styles.sectionLabel, { color: palette.dim }]}>
                {SECTION_LABELS[group.kind]}
              </Text>
              {group.results.map((result) => (
                <ResultRow
                  key={`${result.kind}:${result.id}`}
                  result={result}
                  palette={palette}
                  onPress={onOpen ? () => onOpen(result) : undefined}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Screen>
  );
}

function ResultRow({
  result,
  palette,
  onPress,
}: {
  result: SearchResult;
  palette: Palette;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: palette.ripple }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: palette.divider },
        pressed ? { transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
          {result.title}
        </Text>
        {result.detail ? (
          <Text style={[styles.detail, { color: palette.dim }]} numberOfLines={1}>
            {result.detail}
          </Text>
        ) : null}
      </View>

      <View style={styles.rowRight}>
        {result.amount ? (
          <Text style={[styles.amount, { color: palette.text }]}>
            {formatAmount(result.amount)}
          </Text>
        ) : null}
        {result.date ? (
          <Text style={[styles.date, { color: palette.dim }]}>{result.date}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 52 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  cancel: { fontSize: 16, fontWeight: '600' },

  list: { paddingHorizontal: 20, paddingBottom: 40 },
  hint: { paddingVertical: 30, lineHeight: 20 },
  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flexShrink: 1 },
  rowRight: { alignItems: 'flex-end' },
  title: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 12, marginTop: 2 },
  amount: { fontWeight: '600' },
  date: { fontSize: 11, marginTop: 2 },
});
