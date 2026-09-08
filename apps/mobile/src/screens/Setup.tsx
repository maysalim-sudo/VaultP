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

import { MIN_PASSPHRASE_LENGTH } from '@vaultp/core';

import { paletteFor } from '../components/theme.js';

export function Setup({
  onCreate,
  busy,
  error,
  protectingExistingData,
}: {
  onCreate: (passphrase: string) => void;
  busy: boolean;
  error: string | null;
  /** True when a vault already holds data and is only now getting a passphrase. */
  protectingExistingData: boolean;
}) {
  const palette = paletteFor(useColorScheme());

  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const longEnough = passphrase.length >= MIN_PASSPHRASE_LENGTH;
  const matches = passphrase.length > 0 && passphrase === confirmation;
  const ready = longEnough && matches && acknowledged && !busy;

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

      <TextInput
        value={passphrase}
        onChangeText={setPassphrase}
        placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
        placeholderTextColor={palette.dim}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface },
        ]}
      />

      <TextInput
        value={confirmation}
        onChangeText={setConfirmation}
        placeholder="Type it again"
        placeholderTextColor={palette.dim}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface },
        ]}
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

  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  buttonText: { fontSize: 17, fontWeight: '700' },
});
