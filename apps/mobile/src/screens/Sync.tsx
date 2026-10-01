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
  Alert,
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
  fetchKeyfileFrom,
  parseKeyfile,
  readSetting,
  serializeKeyfile,
  writeSetting,
  type Pairing,
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
import { PairScanner } from '../sync/PairScanner.js';
import { forgetPairing, loadPairing, pairFromCode } from '../sync/pairing.js';
import { useOpenVault, useVault } from '../vault/VaultContext.js';

const FOLDER_SETTING = 'sync_folder_uri';

const isString = (value: unknown): value is string => typeof value === 'string';

export function Sync({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const { computerSync, syncComputer } = useVault();
  const palette = paletteFor(useColorScheme());

  const [folder, setFolder] = useState<string>(() =>
    readSetting(vault.store, FOLDER_SETTING, '', isString),
  );
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<'computer' | 'folder' | 'drive'>('computer');
  const [drive, setDrive] = useState<DriveConnection | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  void version;

  useEffect(() => {
    void loadPairing().then((stored) => setPairing(stored ?? null));
  }, []);

  /**
   * A code was scanned: check the computer answers, make sure it is not holding
   * some other vault, then sync for the first time.
   */
  async function scanned(code: string) {
    setChecking(true);
    setScanError(null);
    try {
      const paired = await pairFromCode(code);

      // Two vaults with different keys cannot be merged — each would see the
      // other's data as noise. Better to say so now than to "sync" and find
      // nothing arrives.
      if (paired.hasVault) {
        const [theirs, ours] = await Promise.all([fetchKeyfileFrom(paired.backend), loadKeyfile()]);
        if (theirs && ours && parseKeyfile(theirs).id !== ours.id) {
          await forgetPairing();
          setScanError(
            `${paired.pairing.name} already holds a different vault, so the two cannot be merged. ` +
              'To use this phone’s vault there, export a backup on the computer first if you need it, then set the computer up again with “I already use VaultP on my phone”.',
          );
          return;
        }
      }

      setPairing(paired.pairing);
      setScanning(false);
      setReport((await syncComputer()) ?? null);
    } catch (caught: unknown) {
      setScanError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }

  async function syncWithPaired() {
    setError(null);
    setReport((await syncComputer()) ?? null);
  }

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
          <View style={styles.targets}>
            {(['computer', 'folder', 'drive'] as const).map((option) => (
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
                  {option === 'computer' ? 'My computer' : option === 'folder' ? 'A folder' : 'Drive'}
                </Text>
              </Pressable>
            ))}
          </View>

          {target === 'computer' ? (
            pairing ? (
              <>
                <View style={[styles.result, { borderColor: palette.border }]}>
                  <Text style={{ color: palette.text, fontWeight: '700', fontSize: 16 }}>
                    Paired with {pairing.name}
                  </Text>
                  <Text style={[styles.small, { color: computerSync.error ? palette.warning : palette.dim }]}>
                    {computerSync.running
                      ? 'Syncing…'
                      : computerSync.error
                        ? computerSync.error
                        : computerSync.lastAt
                          ? `In step as of ${new Date(computerSync.lastAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                          : 'Not synced yet this session'}
                  </Text>
                </View>
                <Text style={[styles.paragraph, { color: palette.dim }]}>
                  The two keep in step by themselves whenever VaultP is open on both and they share a
                  Wi-Fi. Nothing leaves your network, and everything that crosses is already encrypted.
                </Text>
                <Pressable
                  onPress={() => void syncWithPaired()}
                  disabled={computerSync.running}
                  style={[styles.button, { backgroundColor: palette.accent }]}
                >
                  {computerSync.running ? (
                    <ActivityIndicator color={palette.onAccent} />
                  ) : (
                    <Text style={[styles.buttonText, { color: palette.onAccent }]}>Sync now</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Unpair?',
                      `This phone will stop syncing with ${pairing.name} until you scan its code again. Nothing in your vault is deleted.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Unpair',
                          style: 'destructive',
                          onPress: () => void forgetPairing().then(() => setPairing(null)),
                        },
                      ],
                    )
                  }
                  style={styles.link}
                >
                  <Text style={{ color: palette.dim, fontWeight: '600' }}>Unpair</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.lead, { color: palette.text }]}>Pair with your computer</Text>
                <Text style={[styles.paragraph, { color: palette.dim }]}>
                  Open VaultP on the computer, choose <Text style={styles.strong}>Pair a phone</Text>,
                  and scan the code it shows. That is the whole setup — no account, no folder, nothing
                  to install. Both devices need to be on the same Wi-Fi.
                </Text>
                <Pressable
                  onPress={() => {
                    setScanError(null);
                    setScanning(true);
                  }}
                  style={[styles.button, { backgroundColor: palette.accent }]}
                >
                  <Text style={[styles.buttonText, { color: palette.onAccent }]}>Scan the code</Text>
                </Pressable>
              </>
            )
          ) : null}

          {target === 'computer' ? null : (
            <Text style={[styles.paragraph, { color: palette.dim }]}>
              {target === 'folder'
                ? 'Choose a folder this phone and your computer can both reach — one kept in step by Syncthing, a shared drive, or anything similar. Everything written there is already encrypted.'
                : 'Sync through your own Google Drive. Google stores the same encrypted data a folder would.'}
            </Text>
          )}

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
          ) : target === 'drive' ? (
            <Text style={[styles.paragraph, { color: palette.dim }]}>
              {drive?.connected
                ? `Backing up to a Drive folder named ${drive.folderName}.`
                : 'Not connected. Connect Google Drive on the desktop, then sync once ' +
                  'with the computer so this phone receives it — the connection travels ' +
                  'inside the vault, encrypted like everything else.'}
            </Text>
          ) : null}

          {target === 'computer' ? null : (
            <Pressable
              onPress={() => void sync()}
              disabled={busy || !ready}
              style={[styles.button, { backgroundColor: ready ? palette.accent : palette.key }]}
            >
              {busy ? (
                <ActivityIndicator color={palette.onAccent} />
              ) : (
                <Text style={[styles.buttonText, { color: ready ? palette.onAccent : palette.dim }]}>
                  Sync now
                </Text>
              )}
            </Pressable>
          )}

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

          {target === 'folder' ? (
            <Text style={[styles.paragraph, { color: palette.dim }]}>
              On the computer, choose the same folder and enter this passphrase. The
              first sync leaves a key file there so the other device can join —
              it holds only wrapped keys, and is useless without the passphrase.
            </Text>
          ) : null}
        </ScrollView>

        {scanning ? (
          <PairScanner
            working={checking}
            error={scanError}
            onCancel={() => setScanning(false)}
            onCode={(code) => void scanned(code)}
          />
        ) : null}
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
  lead: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  strong: { fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: 8 },
  small: { fontSize: 12 },
  error: { fontSize: 13, fontWeight: '600', lineHeight: 19 },
});
