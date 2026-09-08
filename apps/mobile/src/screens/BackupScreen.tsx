/**
 * Backup and restore.
 *
 * The export is a plain JSON file the user keeps themselves — not a service, not
 * an account. It is what remains if this app is abandoned, and it should be
 * readable in ten years with none of this software.
 *
 * It is also, unavoidably, the entire vault in the clear. The screen says so
 * plainly rather than burying it, because someone about to put this on a shared
 * drive should know that before they do it, not after.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  backupFilename,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from '@vaultp/core';

import { paletteFor } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { Sync } from './Sync.js';
import { useOpenVault } from '../vault/VaultContext.js';

export function BackupScreen({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showingSync, setShowingSync] = useState(false);

  const eventCount = vault.store.allEvents().length;
  void version;

  async function exportToFile() {
    setBusy(true);
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
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your VaultP backup',
        });
        setMessage(`${backup.eventCount} entries exported.`);
      } else {
        setMessage(`Saved to ${file.uri}`);
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function importFromFile() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (picked.canceled) {
        setBusy(false);
        return;
      }

      const backup = parseBackup(await picked.result.text());
      const result = mutate((v) => restoreBackup(v.store, backup));

      setMessage(
        result
          ? `${result.applied} of ${result.total} entries restored.` +
            (result.applied < result.total
              ? ' The rest were already here.'
              : '')
          : 'Nothing to restore.',
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
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
          <Text style={[styles.headerTitle, { color: palette.text }]}>Backup</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.paragraph, { color: palette.dim }]}>
            An export contains everything: every expense, debt, document record and
            correction, including the history. Restoring it onto a new phone
            rebuilds this vault exactly.
          </Text>

          <View style={[styles.warning, { borderColor: palette.warning }]}>
            <Text style={[styles.warningText, { color: palette.warning }]}>
              The file is not encrypted. Anyone who opens it can read everything in
              your vault, so keep it somewhere you would keep the documents
              themselves.
            </Text>
          </View>

          <Text style={[styles.count, { color: palette.text }]}>
            {eventCount} entries in this vault
          </Text>

          <Pressable
            onPress={() => void exportToFile()}
            disabled={busy}
            style={[styles.button, { backgroundColor: palette.accent }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Export a backup</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void importFromFile()}
            disabled={busy}
            style={[
              styles.button,
              { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: palette.text }]}>
              Restore from a file
            </Text>
          </Pressable>

          <Text style={[styles.paragraph, { color: palette.dim }]}>
            Restoring merges rather than replaces: nothing already in this vault is
            lost, and importing the same file twice changes nothing the second
            time.
          </Text>

          <Text style={[styles.paragraph, { color: palette.dim }]}>
            Document images are not in the export — only their details. The scans
            stay encrypted on the device they were taken on.
          </Text>

          <Pressable
            onPress={() => setShowingSync(true)}
            style={[
              styles.button,
              { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: palette.text }]}>
              Sync with another device
            </Text>
          </Pressable>

          {message ? (
            <Text style={[styles.result, { color: palette.success }]}>{message}</Text>
          ) : null}
          {error ? (
            <Text style={[styles.result, { color: palette.danger }]}>{error}</Text>
          ) : null}
        </ScrollView>
        {showingSync ? <Sync onClose={() => setShowingSync(false)} /> : null}
      </View>
    </Screen>
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
  headerSpacer: { width: 44 },

  body: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  paragraph: { fontSize: 13, lineHeight: 20 },
  warning: { borderWidth: 1, borderRadius: 12, padding: 14 },
  warningText: { fontSize: 13, lineHeight: 19 },
  count: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  result: { fontSize: 13, fontWeight: '600', marginTop: 4, lineHeight: 19 },
});
