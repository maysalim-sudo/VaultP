/**
 * Light, dark, or whatever the phone is set to.
 *
 * Every screen already follows `useColorScheme()`, so choosing is one call to
 * `Appearance`, and the rest of the app needs to know nothing about it. The
 * choice is a preference of this phone rather than of the vault: it is read
 * before anything is unlocked, and the computer has its own.
 */

import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

export type ThemeChoice = 'auto' | 'light' | 'dark';

const ITEM = 'vaultp.theme.v1';

function apply(choice: ThemeChoice): void {
  Appearance.setColorScheme(choice === 'auto' ? 'unspecified' : choice);
}

export async function loadThemeChoice(): Promise<ThemeChoice> {
  const stored = await SecureStore.getItemAsync(ITEM).catch(() => null);
  const choice: ThemeChoice = stored === 'light' || stored === 'dark' ? stored : 'auto';
  apply(choice);
  return choice;
}

export function setThemeChoice(choice: ThemeChoice): void {
  apply(choice);
  void SecureStore.setItemAsync(ITEM, choice).catch(() => undefined);
}
