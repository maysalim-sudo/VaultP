/**
 * Getting the data key, and guarding it.
 *
 * Two ways in, both opening the same key:
 *
 *   passphrase  slow, always works, survives a lost phone. The recovery path, and
 *               how a second device is ever set up.
 *   biometric   fast, this device only. A convenience wrapper over the same key,
 *               held in the Android Keystore.
 *
 * The passphrase is the only thing that can rebuild this vault from a backup. It
 * is never stored anywhere — losing it loses the data, which is the point.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import {
  type Keyfile,
  createVault,
  fromBase64,
  newDeviceId,
  parseKeyfile,
  serializeKeyfile,
  toBase64,
  unlockVault,
  type SlotId,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';

const KEYFILE_ITEM = 'vaultp.keyfile.v1';
/**
 * Where the data key lived before passphrases existed.
 *
 * Builds before this one kept the key here alone, guarded by nothing but the
 * device. Those vaults must keep opening: the database is already encrypted with
 * that key, so setting a passphrase adopts it rather than generating a new one.
 * Generating a new key would leave every row already written unreadable.
 */
const LEGACY_DATA_KEY_ITEM = 'vaultp.datakey.v1';
const DEVICE_ID_ITEM = 'vaultp.deviceid.v1';
/** The biometric-gated copy of the data key. Absent until unlock is set up. */
const QUICK_KEY_ITEM = 'vaultp.quickkey.v1';
/**
 * Whether that copy exists: 'on' or 'off'. Holds nothing secret, and is why it
 * can be read freely. Android asks for a fingerprint on every read of the key
 * itself, even one that only wanted to know it was there.
 */
const QUICK_STATE_ITEM = 'vaultp.quickkey.state.v1';

export interface VaultKeyMaterial {
  readonly dataKey: Uint8Array;
  readonly slot: SlotId;
  readonly deviceId: string;
}

export async function hasVault(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEYFILE_ITEM)) !== null;
}

/** An older vault on this device that has data but no passphrase yet. */
export async function hasUnprotectedVault(): Promise<boolean> {
  if (await hasVault()) return false;
  return (await SecureStore.getItemAsync(LEGACY_DATA_KEY_ITEM)) !== null;
}

export async function loadKeyfile(): Promise<Keyfile | undefined> {
  const stored = await SecureStore.getItemAsync(KEYFILE_ITEM);
  return stored ? parseKeyfile(stored) : undefined;
}

async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_ITEM);
  if (existing) return existing;

  const created = newDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_ITEM, created, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return created;
}

/**
 * Create the vault. Runs once, ever.
 *
 * A decoy slot is always written, whether or not a panic passphrase is given, so
 * the keyfile looks identical either way — an absent slot would itself reveal
 * that no decoy exists.
 */
export async function createVaultKeys(
  passphrase: string,
  decoyPassphrase?: string,
): Promise<VaultKeyMaterial> {
  const legacy = await SecureStore.getItemAsync(LEGACY_DATA_KEY_ITEM);

  const created = await createVault(androidCryptoProvider, {
    passphrase,
    ...(decoyPassphrase ? { decoyPassphrase } : {}),
    // Adopt the existing key when there is one, so data already written stays
    // readable. The key does not change; only what guards it does.
    ...(legacy ? { dataKey: fromBase64(legacy) } : {}),
  });

  await SecureStore.setItemAsync(KEYFILE_ITEM, serializeKeyfile(created.keyfile), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });

  // Only once the keyfile is safely written: until then the legacy item is the
  // sole copy of the key, and losing it would lose the vault.
  if (legacy) await SecureStore.deleteItemAsync(LEGACY_DATA_KEY_ITEM);

  return { dataKey: created.dataKey, slot: 'primary', deviceId: await deviceId() };
}

/**
 * Join a vault that already exists on another device.
 *
 * The data key is random, so a second device cannot arrive at it alone: it has
 * to be handed the keyfile — the key, wrapped by the passphrase — and unwrap it.
 * Nothing is stored unless the passphrase opens it, so a wrong guess leaves this
 * phone exactly as it was.
 */
export async function joinVaultKeys(
  serializedKeyfile: string,
  passphrase: string,
): Promise<VaultKeyMaterial> {
  if (await hasVault()) throw new Error('This phone already has a vault.');

  const keyfile = parseKeyfile(serializedKeyfile);
  const opened = await unlockVault(androidCryptoProvider, keyfile, passphrase);

  await SecureStore.setItemAsync(KEYFILE_ITEM, serializeKeyfile(keyfile), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return { dataKey: opened.dataKey, slot: opened.slot, deviceId: await deviceId() };
}

export async function unlockWithPassphrase(
  passphrase: string,
): Promise<VaultKeyMaterial> {
  const keyfile = await loadKeyfile();
  if (!keyfile) throw new Error('No vault on this device yet.');

  const opened = await unlockVault(androidCryptoProvider, keyfile, passphrase);
  return { dataKey: opened.dataKey, slot: opened.slot, deviceId: await deviceId() };
}

// ------------------------------------------------------------ quick unlock

export interface BiometricCapability {
  readonly available: boolean;
  /** True when a fingerprint or face is actually enrolled, not merely supported. */
  readonly enrolled: boolean;
}

export async function biometricCapability(): Promise<BiometricCapability> {
  const [available, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return { available, enrolled };
}

/**
 * Never reads the key: that would be a fingerprint prompt just to decide whether
 * to show one. A vault from before the state was recorded is assumed to have
 * quick unlock, which the first attempt then settles either way.
 */
export async function isQuickUnlockEnabled(): Promise<boolean> {
  const state = await SecureStore.getItemAsync(QUICK_STATE_ITEM);
  return state ? state === 'on' : hasVault();
}

/**
 * Store the data key behind the fingerprint.
 *
 * `requireAuthentication` makes Android refuse to release it without a biometric
 * check, so the key is guarded by the Keystore rather than by this app deciding
 * whether to hand it over.
 *
 * Only the real vault gets a quick-unlock copy. Giving the decoy one too would
 * mean the fingerprint had to choose between two vaults, and the honest answer to
 * "which one does my thumb open" is: the real one.
 */
export async function enableQuickUnlock(dataKey: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(QUICK_KEY_ITEM, toBase64(dataKey), {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
    authenticationPrompt: 'Unlock VaultP',
  });
  await SecureStore.setItemAsync(QUICK_STATE_ITEM, 'on');
}

export async function disableQuickUnlock(): Promise<void> {
  await SecureStore.deleteItemAsync(QUICK_KEY_ITEM);
  await SecureStore.setItemAsync(QUICK_STATE_ITEM, 'off');
}

/**
 * @returns the key, or undefined when the user cancelled or no biometric is set
 *          up. A failure here is never fatal: the passphrase always works.
 */
export async function unlockWithBiometrics(): Promise<VaultKeyMaterial | undefined> {
  try {
    const stored = await SecureStore.getItemAsync(QUICK_KEY_ITEM, {
      requireAuthentication: true,
      authenticationPrompt: 'Unlock VaultP',
    });
    await SecureStore.setItemAsync(QUICK_STATE_ITEM, stored ? 'on' : 'off');
    if (!stored) return undefined;

    return { dataKey: fromBase64(stored), slot: 'primary', deviceId: await deviceId() };
  } catch {
    // Cancelled, failed, or the enrolled fingerprints changed — which invalidates
    // the Keystore entry by design. Fall back to the passphrase.
    return undefined;
  }
}

/** Forget this device's copy of everything. The passphrase can rebuild it. */
export async function forgetDevice(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(QUICK_KEY_ITEM),
    SecureStore.deleteItemAsync(QUICK_STATE_ITEM),
    SecureStore.deleteItemAsync(KEYFILE_ITEM),
  ]);
}
