/**
 * Backup and restore, led by the one question that matters: am I covered?
 *
 * The top of the screen says when the vault was last backed up, how much has
 * changed since, and which of the last four weeks had a backup — a gap in that
 * row is a week the vault went unprotected. Then one primary action.
 *
 * The export is a plain JSON file the user keeps — not a service, not an
 * account — and it should be readable in ten years with none of this software.
 * It is also the entire vault in the clear. That is said right beside the
 * button, in one line, rather than in a paragraph above it that nobody reads.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  backupCoverage,
  backupFilename,
  exportBackup,
  loadBackupHistory,
  parseBackup,
  recordBackup,
  restoreBackup,
  serializeBackup,
  todayIn,
} from '@vaultp/core';

import { Label, PageHead, Tile } from '../components/Industrial.js';
import { Screen } from '../components/Screen.js';
import { loadThemeChoice, setThemeChoice, type ThemeChoice } from '../components/themeChoice.js';
import { fonts, labelStyle, paletteFor, type Palette } from '../components/theme.js';
import { loadPairing } from '../sync/pairing.js';
import { useOpenVault, useVault } from '../vault/VaultContext.js';
import { Sync } from './Sync.js';
import { Glyph, Icon } from '../components/icons.js';

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function BackupScreen({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [busy, setBusy] = useState<null | 'export' | 'restore'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showingSync, setShowingSync] = useState(false);
  const [pairedWith, setPairedWith] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const { computerSync } = useVault();
  const synced = pairedWith !== null && !computerSync.error && computerSync.lastAt !== null;

  useEffect(() => {
    void loadThemeChoice().then(setTheme);
  }, []);

  // Re-read when the sync sheet closes: pairing happens in there.
  useEffect(() => {
    void loadPairing().then((pairing) => setPairedWith(pairing?.name ?? null));
  }, [showingSync]);

  const eventCount = useMemo(() => vault.store.allEvents().length, [vault, version]);
  const history = useMemo(() => loadBackupHistory(vault.store), [vault, version]);
  const last = history[0];
  const coverage = backupCoverage(history, today);
  const covered = coverage.filter(Boolean).length;
  const changedSince = last ? Math.max(0, eventCount - last.events) : eventCount;

  // Covered: backed up within the week. Stale: older, or never.
  const fresh = last !== undefined && Date.now() - Date.parse(last.at) < 7 * 86_400_000;

  async function exportToFile() {
    setBusy('export');
    setError(null);
    setMessage(null);
    try {
      const backup = exportBackup(vault.store);
      const name = backupFilename(backup.exportedAt);

      // The cache, not the vault directory: this file is plaintext, and it should
      // not linger anywhere the app treats as permanent.
      const directory = new Directory(Paths.cache, 'vault-export');
      if (!directory.exists) directory.create({ intermediates: true });
      const file = new File(directory, name);
      if (file.exists) file.delete();
      file.create();
      file.write(serializeBackup(backup));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your VaultP backup' });
      }
      mutate((v) => recordBackup(v.store, backup.eventCount));
      setMessage(`${backup.eventCount} entries backed up.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function importFromFile() {
    setBusy('restore');
    setError(null);
    setMessage(null);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (picked.canceled) return;

      const backup = parseBackup(await picked.result.text());
      const result = mutate((v) => restoreBackup(v.store, backup));
      setMessage(
        result
          ? `${result.applied} of ${result.total} entries restored.` +
              (result.applied < result.total ? ' The rest were already here.' : '')
          : 'Nothing to restore.',
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen onClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.body}>
          <PageHead title="Vault" palette={palette} />

          {/* Is the other device in step? */}
          <Tile palette={palette} style={styles.syncTile} onPress={() => setShowingSync(true)} label="Sync with my computer">
            <View style={[styles.syncRing, { borderColor: palette.border }]}>
              <View style={[styles.syncDot, { backgroundColor: synced ? palette.positive : palette.textFaint }]} />
            </View>
            <View style={styles.statusText}>
              <Text style={[styles.statusTitle, { color: palette.text }]} numberOfLines={1}>
                {computerSync.running ? 'Syncing…' : pairedWith ? 'Paired' : 'Not paired yet'}
              </Text>
              <Label palette={palette} colour={computerSync.error ? palette.accentText : palette.textFaint}>
                {pairedWith ? `PHONE ⇄ ${pairedWith.toUpperCase()}` : 'SCAN A CODE TO KEEP A COMPUTER IN STEP'}
              </Label>
            </View>
            <Icon name="phone" size={18} color={palette.dim} />
          </Tile>

          {/* Am I covered? */}
          <Tile palette={palette}>
            <View style={styles.labelRow}>
              <Label palette={palette}>BACKUP</Label>
              <View style={[styles.tag, { backgroundColor: fresh ? palette.key : palette.accent }]}>
                <Text style={[styles.tagText, { color: fresh ? palette.positive : palette.onAccent }]}>{fresh ? 'COVERED' : 'DUE'}</Text>
              </View>
            </View>
            <Text style={[styles.statusTitle, { color: palette.text }]}>
              {last ? `Last backup ${ago(last.at)}` : 'Not backed up yet'}
            </Text>
            <Text style={[styles.statusSub, { color: palette.dim }]}>
              {last
                ? changedSince === 0
                  ? 'Nothing has changed since.'
                  : `${changedSince} change${changedSince === 1 ? '' : 's'} since then`
                : `${eventCount} entries in this vault, none saved outside it`}
            </Text>
            <View style={styles.weeks}>
              {coverage.map((had, index) => (
                <View key={index} style={[styles.week, { backgroundColor: had ? palette.positive : palette.border }]} />
              ))}
            </View>
            <Label palette={palette}>
              {covered} OF THE LAST {coverage.length} WEEKS BACKED UP
            </Label>
          </Tile>

          {/* The one thing to do. */}
          <ActionCard
            title="Back up now"
            detail="Everything, as one file you keep"
            glyph="↓"
            primary
            busy={busy === 'export'}
            palette={palette}
            onPress={() => void exportToFile()}
          />
          <View style={styles.warning}>
            <Text style={[styles.warningText, { color: palette.text }]}>
              This file is <Text style={styles.bold}>readable</Text>. Keep it somewhere private — not a shared drive.
            </Text>
          </View>

          <ActionCard
            title="Restore from a file"
            detail="Merges in; never overwrites what is here"
            glyph="↑"
            busy={busy === 'restore'}
            palette={palette}
            onPress={() => void importFromFile()}
          />

          {message ? <Text style={[styles.result, { color: palette.positive }]}>{message}</Text> : null}
          {error ? <Text style={[styles.result, { color: palette.danger }]}>{error}</Text> : null}

          <Text style={[styles.fine, { color: palette.dim }]}>
            Images and scans are not in the file — only their details. They stay encrypted on your devices, and sync
            carries them between them.
          </Text>

          <View style={[styles.themes, { backgroundColor: palette.surface }]} accessibilityRole="radiogroup" accessibilityLabel="Theme">
            {(['auto', 'light', 'dark'] as const).map((choice) => {
              const on = theme === choice;
              return (
                <Pressable
                  key={choice}
                  onPress={() => {
                    setTheme(choice);
                    setThemeChoice(choice);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.theme, { backgroundColor: on ? palette.text : 'transparent' }]}
                >
                  <Text style={[labelStyle, { color: on ? palette.background : palette.dim }]}>{choice.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {showingSync ? <Sync onClose={() => setShowingSync(false)} /> : null}
      </View>
    </Screen>
  );
}

function ActionCard({
  title,
  detail,
  glyph,
  primary,
  busy,
  palette,
  onPress,
}: {
  title: string;
  detail: string;
  glyph: string;
  primary?: boolean;
  busy: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.card,
        primary
          ? { backgroundColor: palette.accent }
          : { backgroundColor: palette.surface },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: primary ? palette.onAccent : palette.text }]}>{title}</Text>
        <Text style={[styles.cardDetail, { color: primary ? palette.onAccent : palette.dim }, primary ? styles.soft : null]}>
          {detail}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={primary ? palette.onAccent : palette.text} />
      ) : (
        <Glyph glyph={glyph} color={primary ? palette.onAccent : palette.text} size={22} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressed: { transform: [{ scale: 0.98 }] },
  body: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  syncTile: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  syncRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  syncDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { flex: 1, gap: 4 },
  statusTitle: { fontFamily: fonts.uiSemibold, fontSize: 17, letterSpacing: -0.2 },
  statusSub: { fontFamily: fonts.ui, fontSize: 13 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontFamily: fonts.monoMedium, fontSize: 9, letterSpacing: 1.3 },

  weeks: { flexDirection: 'row', gap: 4 },
  week: { flex: 1, height: 10, borderRadius: 2 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, padding: 18 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  cardDetail: { fontFamily: fonts.ui, fontSize: 13 },
  soft: { opacity: 0.8 },

  warning: { paddingHorizontal: 18 },
  warningText: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 19 },
  bold: { fontFamily: fonts.uiBold },

  result: { fontFamily: fonts.uiSemibold, fontSize: 13, lineHeight: 19, paddingHorizontal: 6 },
  fine: { fontFamily: fonts.ui, fontSize: 12, lineHeight: 18, paddingHorizontal: 6 },

  themes: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999 },
  theme: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});