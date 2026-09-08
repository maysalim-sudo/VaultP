import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Shell } from './src/screens/Shell.js';
import { Setup } from './src/screens/Setup.js';
import { Unlock } from './src/screens/Unlock.js';
import { VaultProvider, useVault } from './src/vault/VaultContext.js';

function VaultGate() {
  const { state, busy, error, create, unlockPassphrase, unlockBiometric } = useVault();

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
