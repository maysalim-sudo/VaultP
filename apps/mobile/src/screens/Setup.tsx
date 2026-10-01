/**
 * Creating the vault. Seen once.
 *
 * The one screen where being slightly annoying is correct: the passphrase entered
 * here is the only thing that can ever rebuild this vault, and someone who breezes
 * past it will not have written it down.
 *
 * So it asks twice, states plainly what losing it costs, and requires the warning
 * to be acknowledged. No "skip for now" — a vault that starts unprotected tends to
 * stay that way.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { MIN_PASSPHRASE_LENGTH, fetchKeyfileFrom } from '@vaultp/core';

import { PassphraseField } from '../components/PassphraseField.js';
import { paletteFor } from '../components/theme.js';
import { PairScanner } from '../sync/PairScanner.js';
import { pairFromCode } from '../sync/pairing.js';

export function Setup({
  onCreate,
  onJoin,
  busy,
  error,
  protectingExistingData,
}: {
  onCreate: (passphrase: string) => void;
  /** Join the vault on a paired computer: its keyfile, and the passphrase typed. */
  onJoin: (serializedKeyfile: string, passphrase: string) => void;
  busy: boolean;
  error: string | null;
  /** True when a vault already holds data and is only now getting a passphrase. */
  protectingExistingData: boolean;
}) {
  const palette = paletteFor(useColorScheme());

  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [visible, setVisible] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [found, setFound] = useState<{ keyfile: string; computer: string } | null>(null);

  const longEnough = passphrase.length >= MIN_PASSPHRASE_LENGTH;
  const matches = passphrase.length > 0 && passphrase === confirmation;
  const ready = longEnough && matches && acknowledged && !busy;

  async function scanned(code: string) {
    setChecking(true);
    setScanError(null);
    try {
      const { backend, pairing, hasVault } = await pairFromCode(code);
      const keyfile = hasVault ? await fetchKeyfileFrom(backend) : undefined;
      if (!keyfile) {
        setScanError(
          `${pairing.name} has no vault yet. Create one here instead, then pair from the Sync screen and it will be sent across.`,
        );
        return;
      }
      setFound({ keyfile, computer: pairing.name });
      setScanning(false);
    } catch (caught: unknown) {
      setScanError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }

  if (found) {
    return (
      <JoinVault
        computer={found.computer}
        busy={busy}
        error={error}
        palette={palette}
        onJoin={(typed) => onJoin(found.keyfile, typed)}
        onBack={() => setFound(null)}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { backgroundColor: palette.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.text }]}>
        {protectingExistingData ? 'Protect your vault' : 'Set a passphrase'}
      </Text>
      <Text style={[styles.body, { color: palette.dim }]}>
        {protectingExistingData
          ? 'Everything already in the vault stays exactly where it is — this adds a ' +
            'lock to it. Day to day you will unlock with your fingerprint; the ' +
            'passphrase is for setting up a new phone, and for getting your data back ' +
            'if this one is lost.'
          : 'It encrypts everything in this vault. Day to day you will unlock with ' +
            'your fingerprint — this is for setting up a new phone, and for getting ' +
            'your data back if this one is lost.'}
      </Text>

      {/* One switch for both fields: seeing only one of the two would not help
          anyone find where they differ. */}
      <PassphraseField
        value={passphrase}
        onChangeText={setPassphrase}
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
        palette={palette}
      />

      <PassphraseField
        value={confirmation}
        onChangeText={setConfirmation}
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        placeholder="Type it again"
        palette={palette}
      />

      {passphrase.length > 0 && !longEnough ? (
        <Text style={[styles.hint, { color: palette.warning }]}>
          {MIN_PASSPHRASE_LENGTH - passphrase.length} more character
          {MIN_PASSPHRASE_LENGTH - passphrase.length === 1 ? '' : 's'} needed.
        </Text>
      ) : null}

      {confirmation.length > 0 && !matches ? (
        <Text style={[styles.hint, { color: palette.warning }]}>
          The two do not match yet.
        </Text>
      ) : null}

      <Text style={[styles.hint, { color: palette.dim }]}>
        Four or five unrelated words are easier to remember and harder to break than
        one mangled word.
      </Text>

      <Pressable
        onPress={() => setAcknowledged((current) => !current)}
        style={[
          styles.acknowledge,
          { borderColor: acknowledged ? palette.danger : palette.border },
        ]}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: acknowledged ? palette.danger : palette.border,
              backgroundColor: acknowledged ? palette.danger : 'transparent',
            },
          ]}
        >
          {acknowledged ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={[styles.acknowledgeText, { color: palette.text }]}>
          I have written this passphrase down somewhere safe. Nobody can reset it,
          and without it the data cannot be recovered.
        </Text>
      </Pressable>

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <Pressable
        onPress={() => onCreate(passphrase)}
        disabled={!ready}
        style={[styles.button, { backgroundColor: ready ? palette.accent : palette.key }]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.buttonText, { color: ready ? '#fff' : palette.dim }]}>
            Create vault
          </Text>
        )}
      </Pressable>

      {busy ? (
        // The key derivation is deliberately slow, and a phone is slower still.
        // Saying so stops it looking like a hang.
        <Text style={[styles.hint, { color: palette.dim, textAlign: 'center' }]}>
          Deriving the key. This is meant to be slow — it is what makes a stolen
          backup expensive to attack.
        </Text>
      ) : null}

      {/* The other way in: the vault already exists, on the computer. Not offered
          when this phone holds older data waiting for a passphrase — joining
          another vault would strand it. */}
      {!protectingExistingData && !busy ? (
        <Pressable onPress={() => setScanning(true)} style={styles.joinLink}>
          <Text style={[styles.joinText, { color: palette.accent }]}>
            I already use VaultP on my computer
          </Text>
        </Pressable>
      ) : null}

      {scanning ? (
        <PairScanner
          working={checking}
          error={scanError}
          onCancel={() => {
            setScanning(false);
            setScanError(null);
          }}
          onCode={(code) => void scanned(code)}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * The vault is on the computer; this phone needs only its passphrase.
 *
 * One field, not two: the passphrase already exists and is being recalled, not
 * invented, so there is nothing to confirm — a wrong one simply does not open.
 */
function JoinVault({
  computer,
  busy,
  error,
  palette,
  onJoin,
  onBack,
}: {
  computer: string;
  busy: boolean;
  error: string | null;
  palette: ReturnType<typeof paletteFor>;
  onJoin: (passphrase: string) => void;
  onBack: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [visible, setVisible] = useState(false);
  const ready = passphrase.length > 0 && !busy;

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { backgroundColor: palette.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.text }]}>Open your vault</Text>
      <Text style={[styles.body, { color: palette.dim }]}>
        Found your vault on {computer}. Enter the passphrase you use there — it is checked on this
        phone and never sent anywhere.
      </Text>

      <PassphraseField
        value={passphrase}
        onChangeText={setPassphrase}
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        placeholder="Your passphrase"
        palette={palette}
        autoFocus
        onSubmitEditing={() => ready && onJoin(passphrase)}
      />

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <Pressable
        onPress={() => onJoin(passphrase)}
        disabled={!ready}
        style={[styles.button, { backgroundColor: ready ? palette.accent : palette.key }]}
      >
        {busy ? (
          <ActivityIndicator color={palette.onAccent} />
        ) : (
          <Text style={[styles.buttonText, { color: ready ? palette.onAccent : palette.dim }]}>
            Open vault
          </Text>
        )}
      </Pressable>

      {busy ? (
        <Text style={[styles.hint, { color: palette.dim, textAlign: 'center' }]}>
          Opening, then bringing everything across from the computer. Keep both on the same Wi-Fi.
        </Text>
      ) : (
        <Pressable onPress={onBack} style={styles.joinLink}>
          <Text style={[styles.joinText, { color: palette.dim }]}>Back</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16 },
  hint: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 13, fontWeight: '600' },

  acknowledge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { color: '#fff', fontWeight: '900', fontSize: 13 },
  acknowledgeText: { flexShrink: 1, fontSize: 13, lineHeight: 19 },

  joinLink: { alignItems: 'center', paddingVertical: 14 },
  joinText: { fontSize: 15, fontWeight: '600' },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  buttonText: { fontSize: 17, fontWeight: '700' },
});
