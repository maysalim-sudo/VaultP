/**
 * The lock screen.
 *
 * Biometric first and automatically, because this app is opened several times a
 * day to log a coffee and a passphrase prompt every time would get the lock turned
 * off entirely. The passphrase is always available underneath.
 *
 * There is deliberately no attempt counter and no lockout. The data is encrypted:
 * guessing here gains nothing that guessing against a stolen backup would not, and
 * a counter this app enforces itself could be reset by clearing app data.
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

import { PassphraseField } from '../components/PassphraseField.js';
import { fonts, paletteFor } from '../components/theme.js';

export function Unlock({
  onPassphrase,
  onBiometric,
  quickUnlockAvailable,
  busy,
  error,
}: {
  onPassphrase: (passphrase: string) => void;
  onBiometric: () => void;
  quickUnlockAvailable: boolean;
  busy: boolean;
  error: string | null;
}) {
  const palette = paletteFor(useColorScheme());
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(!quickUnlockAvailable);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Prompt straight away rather than making the user tap a button to be asked
    // for a fingerprint; the tap adds nothing.
    if (quickUnlockAvailable) onBiometric();
    // Only on mount: re-running this on every render would loop the prompt.
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { backgroundColor: palette.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.text }]}>VaultP</Text>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator />
          <Text style={[styles.hint, { color: palette.dim }]}>Unlocking…</Text>
        </View>
      ) : null}

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      {showPassphrase ? (
        <>
          <PassphraseField
            value={passphrase}
            onChangeText={setPassphrase}
            visible={visible}
            onToggle={() => setVisible((current) => !current)}
            placeholder="Passphrase"
            palette={palette}
            autoFocus={!quickUnlockAvailable}
            onSubmitEditing={() => onPassphrase(passphrase)}
          />
          <Pressable
            onPress={() => onPassphrase(passphrase)}
            disabled={passphrase.length === 0 || busy}
            style={[
              styles.button,
              {
                backgroundColor:
                  passphrase.length > 0 && !busy ? palette.accent : palette.key,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: passphrase.length > 0 && !busy ? palette.onAccent : palette.dim },
              ]}
            >
              Unlock
            </Text>
          </Pressable>
        </>
      ) : null}

      {quickUnlockAvailable ? (
        <Pressable onPress={onBiometric} style={styles.link} disabled={busy}>
          <Text style={{ color: palette.accentText, fontWeight: '600' }}>
            Use fingerprint
          </Text>
        </Pressable>
      ) : null}

      {quickUnlockAvailable && !showPassphrase ? (
        <Pressable onPress={() => setShowPassphrase(true)} style={styles.link}>
          <Text style={{ color: palette.dim }}>Use passphrase instead</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14 },
  title: { fontFamily: fonts.uiBold, fontSize: 32, textAlign: 'center', marginBottom: 12 },
  busy: { alignItems: 'center', gap: 8 },
  hint: { fontFamily: fonts.ui, fontSize: 13 },
  error: { fontFamily: fonts.uiSemibold, fontSize: 13, textAlign: 'center' },
  button: { borderRadius: 999, paddingVertical: 17, alignItems: 'center' },
  buttonText: { fontFamily: fonts.uiBold, fontSize: 17, },
  link: { alignItems: 'center', paddingVertical: 10 },
});
