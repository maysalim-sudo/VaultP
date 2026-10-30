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
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  backupCoverage,
  backupFilename,
  exportBackup,
  loadBackupHistory,
  parseBackup,
  radii,
  recordBackup,
  restoreBackup,
  serializeBackup,
  spacing,
  todayIn,
  typeScale,
} from '@vaultp/core';

import { Screen } from '../components/Screen.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { Sync } from './Sync.js';
import { Glyph } from '../components/icons.js';

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
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.back, { color: palette.dim }]}>←</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.title, { color: palette.text }]}>Backup</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* Am I covered? */}
          <View style={styles.status}>
            <View
              style={[
                styles.shield,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.shieldGlyph, { color: fresh ? palette.positive : palette.warning }]}>
                {fresh ? '✓' : '!'}
              </Text>
            </View>
            <View style={styles.statusText}>
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
            </View>
          </View>

          <View style={styles.weeks}>
            {coverage.map((had, index) => (
              <View
                key={index}
                style={[styles.week, { backgroundColor: had ? palette.positive : palette.key }]}
              />
            ))}
          </View>
          <Text style={[styles.weeksCaption, { color: palette.dim }]}>
            {covered} of the last {coverage.length} weeks backed up
          </Text>

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
          <View style={[styles.warning, { borderLeftColor: palette.warning }]}>
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

          <Text style={[styles.section, { color: palette.dim }]}>Your other device</Text>
          <ActionCard
            title="Sync with my computer"
            detail="Scan a code once; they keep in step by themselves"
            glyph="⇄"
            busy={false}
            palette={palette}
            onPress={() => setShowingSync(true)}
          />
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
          ? { backgroundColor: palette.accent, borderColor: palette.accent }
          : { backgroundColor: palette.surface, borderColor: palette.border },
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
  screen: { flex: 1, paddingTop: 4 },
  pressed: { transform: [{ scale: 0.97 }] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  back: { fontSize: 24, fontWeight: '600' },
  title: { fontSize: typeScale.xl, fontWeight: '700', letterSpacing: -0.5 },

  body: { paddingHorizontal: spacing.lg, paddingBottom: 56, gap: spacing.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  shield: { width: 52, height: 52, borderRadius: radii.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shieldGlyph: { fontSize: 24, fontWeight: '800' },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { fontSize: typeScale.lg, fontWeight: '700' },
  statusSub: { fontSize: typeScale.sm },

  weeks: { flexDirection: 'row', gap: 4, marginTop: spacing.xs },
  week: { flex: 1, height: 6, borderRadius: radii.pill },
  weeksCaption: { fontSize: typeScale.xs, marginTop: -6 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginTop: spacing.xs,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typeScale.md, fontWeight: '700' },
  cardDetail: { fontSize: typeScale.sm },
  soft: { opacity: 0.8 },
  cardGlyph: { fontSize: 22, fontWeight: '700' },

  warning: { borderLeftWidth: 3, paddingLeft: spacing.md, paddingVertical: 4, borderRadius: 0 },
  warningText: { fontSize: typeScale.sm, lineHeight: 19 },
  bold: { fontWeight: '700' },

  result: { fontSize: typeScale.sm, fontWeight: '600', lineHeight: 19 },
  fine: { fontSize: typeScale.xs, lineHeight: 18, marginTop: spacing.sm },
  section: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
  },
});
