/**
 * Sync, on the phone.
 *
 * Pick a folder both devices can see; press Sync. Nothing else to configure, no
 * account to make, nothing that expires.
 *
 * The screen reports what actually moved rather than saying "done", because the
 * useful question after a sync is whether the other device's changes arrived —
 * and the honest answer is sometimes "nothing did, because nothing had changed".
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Directory } from 'expo-file-system';

import {
  DriveBackend,
  SyncEngine,
  readSetting,
  serializeKeyfile,
  writeSetting,
  type SyncReport,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';
import { phoneFileStore } from '../documents/fileStore.js';
import { driveAuthFor, driveConnection, type DriveConnection } from '../sync/driveAuth.js';
import { phoneDriveHttp } from '../sync/driveHttp.js';
import { paletteFor } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { loadKeyfile } from '../vault/keys.js';
import { PhoneFolderBackend } from '../sync/folderBackend.js';
import { useOpenVault } from '../vault/VaultContext.js';

const FOLDER_SETTING = 'sync_folder_uri';

const isString = (value: unknown): value is string => typeof value === 'string';

export function Sync({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [folder, setFolder] = useState<string>(() =>
    readSetting(vault.store, FOLDER_SETTING, '', isString),
  );
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<'folder' | 'drive'>('folder');
  const [drive, setDrive] = useState<DriveConnection | null>(null);
  void version;

  // The connection is whatever the desktop stored and sync carried here, so it
  // is re-read whenever the vault changes rather than held from first render.
  useEffect(() => {
    let current = true;
    void driveConnection(vault.store, vault.keys).then((connection) => {
      if (current) setDrive(connection);
    });
    return () => {
      current = false;
    };
  }, [vault, version]);

  const ready = target === 'drive' ? drive?.connected === true : folder !== '';

  async function choose() {
    setError(null);
    try {
      // The system picker: Android grants access to this one tree and nothing
      // else, and the grant survives restarts.
      const picked = await Directory.pickDirectoryAsync();
      if (!picked) return;

      mutate((v) => writeSetting(v.store, FOLDER_SETTING, picked.uri));
      setFolder(picked.uri);
      setReport(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function sync() {
    if (!ready) return;
    setBusy(true);
    setError(null);

    try {
      // A folder and a Drive account are the same four operations to everything
      // above this line, which is why choosing between them is one expression.
      const backend =
        target === 'drive'
          ? new DriveBackend({
              auth: driveAuthFor(vault.store, vault.keys),
              folderName: drive?.folderName ?? 'VaultP',
              // React Native cannot put bytes in a fetch body; this routes them
              // through a file instead.
              http: phoneDriveHttp(),
            })
          : new PhoneFolderBackend(folder);

      const engine = new SyncEngine({
        store: vault.store,
        backend,
        provider: androidCryptoProvider,
        oplogKey: vault.keys.oplog,
        // Carries the scans as well as the records. They cross already sealed,
        // so the folder never holds anything readable.
        files: phoneFileStore(),
      });

      // Publish the keyfile so the other device can join with the passphrase
      // alone. Both devices must open the same data key — it is random, not
      // derived from the passphrase — so without this a second device would
      // create its own vault and the two would never converge. It holds only
      // wrapped keys, which is why it is safe to leave beside the segments.
      const keyfile = await loadKeyfile();
      if (keyfile) await engine.publishKeyfile(serializeKeyfile(keyfile));

      const result = await engine.sync();
      setReport(result);
      // Anything pulled changes what every screen shows.
      mutate(() => undefined);
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
          <Text style={[styles.headerTitle, { color: palette.text }]}>Sync</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.paragraph, { color: palette.dim }]}>
            Choose a folder this phone and your computer can both reach — one kept
            in step by Syncthing, a shared drive, or anything similar. There is no
            account and nothing to sign in to.
          </Text>

          <Text style={[styles.paragraph, { color: palette.dim }]}>
            Everything written there is already encrypted. Whatever moves the files
            sees ciphertext and filenames, nothing else.
          </Text>

          <View style={styles.targets}>
            {(['folder', 'drive'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setTarget(option)}
                style={[
                  styles.target,
                  {
                    backgroundColor: target === option ? palette.accent : palette.surface,
                    borderColor: target === option ? palette.accent : palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: target === option ? '#fff' : palette.text },
                  ]}
                >
                  {option === 'folder' ? 'A folder' : 'Google Drive'}
                </Text>
              </Pressable>
            ))}
          </View>

          {target === 'folder' ? (
            <>
              <Pressable
                onPress={() => void choose()}
                style={[
                  styles.button,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: palette.text }]}>
                  {folder === '' ? 'Choose a folder' : 'Change folder'}
                </Text>
              </Pressable>

              {folder !== '' ? (
                <Text style={[styles.folder, { color: palette.dim }]} numberOfLines={2}>
                  {decodeURIComponent(folder)}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.paragraph, { color: palette.dim }]}>
              {drive?.connected
                ? `Backing up to a Drive folder named ${drive.folderName}.`
                : 'Not connected. Connect Google Drive on the desktop, then sync once ' +
                  'through a folder so this phone receives it — the connection travels ' +
                  'inside the vault, encrypted like everything else.'}
            </Text>
          )}

          <Pressable
            onPress={() => void sync()}
            disabled={busy || !ready}
            style={[styles.button, { backgroundColor: ready ? palette.accent : palette.key }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.buttonText, { color: ready ? '#fff' : palette.dim }]}>
                Sync now
              </Text>
            )}
          </Pressable>

          {report ? (
            <View style={[styles.result, { borderColor: palette.border }]}>
              <Text style={{ color: palette.text, fontWeight: '600' }}>
                {report.appliedEvents > 0
                  ? `${report.appliedEvents} change${report.appliedEvents === 1 ? '' : 's'} arrived`
                  : 'Already up to date'}
              </Text>
              <Text style={[styles.small, { color: palette.dim }]}>
                sent {report.pushedEvents} in {report.pushedSegments} file
                {report.pushedSegments === 1 ? '' : 's'} · read {report.pulledEvents} from{' '}
                {report.pulledSegments}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
          ) : null}

          <Text style={[styles.paragraph, { color: palette.dim }]}>
            On the computer, choose the same folder and enter this passphrase. The
            first sync leaves a key file there so the other device can join —
            it holds only wrapped keys, and is useless without the passphrase.
          </Text>
        </ScrollView>
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
  folder: { fontSize: 11, lineHeight: 16 },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  targets: { flexDirection: 'row', gap: 10 },
  target: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontWeight: '700', fontSize: 16 },
  result: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  small: { fontSize: 12 },
  error: { fontSize: 13, fontWeight: '600', lineHeight: 19 },
});
