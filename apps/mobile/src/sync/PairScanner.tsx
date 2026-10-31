/**
 * Scanning the pairing code on the computer's screen.
 *
 * Full screen, camera first: there is one thing to do here and the viewfinder
 * is it. A code that is not VaultP's is ignored with a word of explanation
 * rather than an error — phones see plenty of QR codes that are not ours.
 *
 * The camera sees the code, and the code is the whole exchange: the secret
 * inside it never travels over the network it will protect.
 */

import { fonts } from '../components/theme.js';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PAIRING_SCHEME, radii, spacing, typeScale } from '@vaultp/core';

export function PairScanner({
  onCode,
  onCancel,
  working,
  error,
}: {
  /** A VaultP pairing code was read. */
  onCode: (code: string) => void;
  onCancel: () => void;
  /** The code is being checked with the computer. */
  working: boolean;
  error: string | null;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [stray, setStray] = useState(false);
  // The camera reports the same code many times a second; act on it once.
  const handled = useRef<string | null>(null);

  function scanned(data: string) {
    if (working) return;
    if (!data.startsWith(PAIRING_SCHEME)) {
      setStray(true);
      return;
    }
    if (handled.current === data) return;
    handled.current = data;
    setStray(false);
    onCode(data);
  }

  // A failed attempt may be retried with the same code.
  if (error && handled.current) handled.current = null;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={styles.screen}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => scanned(data)}
          />
        ) : null}

        <View style={styles.top}>
          <Text style={styles.title}>Scan the code on your computer</Text>
          <Text style={styles.body}>
            On the computer, open VaultP, pick <Text style={styles.strong}>Sync with my phone</Text> at
            the top and press <Text style={styles.strong}>Pair a phone</Text> — or, on a new computer,
            choose <Text style={styles.strong}>I already use VaultP on my phone</Text>.
          </Text>
        </View>

        {permission?.granted ? (
          <View style={styles.frame} pointerEvents="none">
            {working ? <ActivityIndicator color="#fff" size="large" /> : null}
          </View>
        ) : (
          <View style={styles.permission}>
            <Text style={styles.body}>
              {permission === null
                ? 'Checking camera access…'
                : 'VaultP needs the camera to read the code. Nothing is photographed or saved.'}
            </Text>
            {permission && !permission.granted ? (
              <Pressable
                onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
                style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
              >
                <Text style={styles.buttonText}>
                  {permission.canAskAgain ? 'Allow the camera' : 'Open settings'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.bottom}>
          {working ? <Text style={styles.status}>Found it — connecting to the computer…</Text> : null}
          {!working && error ? <Text style={[styles.status, styles.error]}>{error}</Text> : null}
          {!working && !error && stray ? (
            <Text style={styles.status}>That is a different code. Look for the one in VaultP on the computer.</Text>
          ) : null}
          <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : null]}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', justifyContent: 'space-between' },
  pressed: { transform: [{ scale: 0.97 }] },
  top: { paddingTop: 64, paddingHorizontal: spacing.xl, gap: spacing.sm, backgroundColor: 'rgba(0, 0, 0, 0.55)', paddingBottom: spacing.lg },
  title: { color: '#fff', fontFamily: fonts.uiBold, fontSize: typeScale.lg, },
  body: { color: 'rgba(255, 255, 255, 0.82)', fontFamily: fonts.ui, fontSize: typeScale.base, lineHeight: 21 },
  strong: { color: '#fff', fontFamily: fonts.uiBold },
  frame: {
    alignSelf: 'center',
    width: 250,
    height: 250,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { paddingHorizontal: spacing.xl, gap: spacing.lg, alignItems: 'center' },
  button: { backgroundColor: '#7EA0B8', borderRadius: radii.lg, paddingVertical: 14, paddingHorizontal: spacing.xl },
  buttonText: { color: '#0B0E12', fontFamily: fonts.uiBold, fontSize: typeScale.md },
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: 44, paddingTop: spacing.lg, gap: spacing.md, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  status: { color: '#fff', fontFamily: fonts.ui, fontSize: typeScale.base, textAlign: 'center', lineHeight: 21 },
  error: { color: '#D49D42', fontFamily: fonts.uiSemibold },
  cancel: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: spacing.xl },
  cancelText: { color: '#fff', fontFamily: fonts.uiSemibold, fontSize: typeScale.md, },
});
