import { Doto_800ExtraBold } from '@expo-google-fonts/doto';
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
} from '@expo-google-fonts/inter-tight';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { loadThemeChoice } from './src/components/themeChoice.js';

import { Shell } from './src/screens/Shell.js';
import { Setup } from './src/screens/Setup.js';
import { Unlock } from './src/screens/Unlock.js';
import { VaultProvider, useVault } from './src/vault/VaultContext.js';

function VaultGate() {
  const { state, busy, error, create, join, unlockPassphrase, unlockBiometric } = useVault();

  switch (state.status) {
    case 'checking':
      return (
        <View style={styles.centre}>
          <ActivityIndicator size="large" />
        </View>
      );

    case 'needs_setup':
      return (
        <Setup
          onCreate={create}
          onJoin={join}
          busy={busy}
          error={error}
          protectingExistingData={state.protectingExistingData}
        />
      );

    case 'locked':
      return (
        <Unlock
          onPassphrase={unlockPassphrase}
          onBiometric={unlockBiometric}
          quickUnlockAvailable={state.quickUnlockAvailable}
          busy={busy}
          error={error}
        />
      );

    case 'open':
      return <Shell />;
  }
}

export default function App() {
  useEffect(() => {
    void loadThemeChoice();
  }, []);

  // Bundled with the app (SIL OFL), never fetched. Until they are registered a
  // screen would flash in the system face and jump, so the first frame waits.
  const [fontsReady, fontError] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    InterTight_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Doto_800ExtraBold,
  });
  // A font that fails to load is not worth locking someone out of their vault:
  // the system face takes over.
  if (!fontsReady && !fontError) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <VaultProvider>
      <VaultGate />
      <StatusBar style="auto" />
    </VaultProvider>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
