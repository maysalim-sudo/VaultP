/**
 * Vault lifecycle: locked, unlocking, open.
 *
 * The vault is opened once per launch and held for the life of the process. It is
 * not re-locked on backgrounding — for an app opened five times a day to log a
 * coffee, a fingerprint prompt every time is the fastest route to the lock being
 * switched off altogether. Killing the app locks it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { runAutoLog, todayIn, type SyncReport } from '@vaultp/core';

import { clearPreviews } from '../documents/fileStore.js';
import { syncNotifications } from '../notifications/schedule.js';
import { syncWithComputer } from '../sync/pairing.js';
import {
  biometricCapability,
  createVaultKeys,
  enableQuickUnlock,
  hasUnprotectedVault,
  hasVault,
  isQuickUnlockEnabled,
  joinVaultKeys,
  unlockWithBiometrics,
  unlockWithPassphrase,
  type VaultKeyMaterial,
} from './keys.js';
import { openVault, seedCategories, type OpenVault } from './open.js';

type VaultState =
  | { status: 'checking' }
  | { status: 'needs_setup'; protectingExistingData: boolean }
  | { status: 'locked'; quickUnlockAvailable: boolean }
  | { status: 'open'; vault: OpenVault };

export interface ComputerSyncState {
  readonly running: boolean;
  /** When the last sync with the paired computer succeeded. */
  readonly lastAt: string | null;
  /** Why the last attempt failed, if it did. */
  readonly error: string | null;
}

interface VaultContextValue {
  readonly state: VaultState;
  readonly busy: boolean;
  readonly error: string | null;
  readonly create: (passphrase: string) => void;
  /** Join a vault from another device: its keyfile, and the passphrase for it. */
  readonly join: (serializedKeyfile: string, passphrase: string) => void;
  readonly computerSync: ComputerSyncState;
  /** Sync with the paired computer now. Undefined when not paired or it failed. */
  readonly syncComputer: () => Promise<SyncReport | undefined>;
  readonly unlockPassphrase: (passphrase: string) => void;
  readonly unlockBiometric: () => void;
  readonly version: number;
  readonly mutate: <T>(fn: (vault: OpenVault) => T) => T | undefined;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState>({ status: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [exists, quick, unprotected] = await Promise.all([
        hasVault(),
        isQuickUnlockEnabled(),
        hasUnprotectedVault(),
      ]);
      if (cancelled) return;
      setState(
        exists
          ? { status: 'locked', quickUnlockAvailable: quick }
          : { status: 'needs_setup', protectingExistingData: unprotected },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --------------------------------------------------- the paired computer
  //
  // Once paired, the phone keeps itself in step without being asked: when the
  // vault opens, when the app comes back to the front, and a few seconds after
  // anything changes. It fails quietly — the computer being off is normal —
  // and the Sync screen is where the last result can be read.

  const openRef = useRef<OpenVault | null>(null);
  const [computerSync, setComputerSync] = useState<ComputerSyncState>({
    running: false,
    lastAt: null,
    error: null,
  });
  const lastAttempt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncComputer = useCallback(async (): Promise<SyncReport | undefined> => {
    const vault = openRef.current;
    if (!vault) return undefined;

    lastAttempt.current = Date.now();
    setComputerSync((current) => ({ ...current, running: true }));
    try {
      const report = await syncWithComputer(vault);
      if (!report) {
        setComputerSync((current) => ({ ...current, running: false }));
        return undefined;
      }
      setComputerSync({ running: false, lastAt: new Date().toISOString(), error: null });
      // Something arrived: every screen is showing the state from before.
      if (report.appliedEvents > 0 || report.downloadedFiles > 0 || report.removedFiles > 0) {
        setVersion((current) => current + 1);
        void syncNotifications(vault).catch(() => undefined);
      }
      return report;
    } catch (caught: unknown) {
      setComputerSync((current) => ({
        ...current,
        running: false,
        error: caught instanceof Error ? caught.message : String(caught),
      }));
      return undefined;
    }
  }, []);

  const syncComputerSoon = useCallback(
    (delayMs: number) => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => void syncComputer(), delayMs);
    },
    [syncComputer],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // Back to the front after a while away: the other device may have moved on.
      if (next === 'active' && openRef.current && Date.now() - lastAttempt.current > 20_000) {
        void syncComputer();
      }
    });
    return () => subscription.remove();
  }, [syncComputer]);

  /** Shared tail of every way in: open the database and catch up on the schedule. */
  const finishOpening = useCallback(
    async (material: VaultKeyMaterial, options: { joined?: boolean } = {}) => {
      const vault = await openVault(material);
      // A crash while viewing a document can leave a decrypted copy in the cache.
      // Clearing on every unlock bounds how long one can survive.
      clearPreviews();
      openRef.current = vault;

      if (options.joined) {
        // A vault joined from another device arrives empty and is about to be
        // filled by sync. Seeding starter categories first would write them
        // again with a newer timestamp, wiping limits set on the other device.
        await syncWithComputer(vault).catch(() => undefined);
      }
      seedCategories(vault);
      runAutoLog(vault.expenses, todayIn());
      setState({ status: 'open', vault });
      void syncNotifications(vault).catch(() => undefined);
      void syncComputer();
    },
    [syncComputer],
  );

  const join = useCallback(
    (serializedKeyfile: string, passphrase: string) => {
      setBusy(true);
      setError(null);

      void (async () => {
        try {
          const material = await joinVaultKeys(serializedKeyfile, passphrase);

          const biometrics = await biometricCapability();
          if (biometrics.available && biometrics.enrolled) {
            await enableQuickUnlock(material.dataKey).catch(() => undefined);
          }
          await finishOpening(material, { joined: true });
        } catch (caught: unknown) {
          setError(caught instanceof Error ? caught.message : 'That passphrase did not work.');
        } finally {
          setBusy(false);
        }
      })();
    },
    [finishOpening],
  );

  const create = useCallback(
    (passphrase: string) => {
      setBusy(true);
      setError(null);

      void (async () => {
        try {
          const material = await createVaultKeys(passphrase);

          // Offer the fingerprint immediately: the passphrase has just been typed
          // and acknowledged, so this is the one moment the trade is obvious.
          const biometrics = await biometricCapability();
          if (biometrics.available && biometrics.enrolled) {
            await enableQuickUnlock(material.dataKey).catch(() => undefined);
          }

          await finishOpening(material);
        } catch (caught: unknown) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setBusy(false);
        }
      })();
    },
    [finishOpening],
  );

  const unlockPassphrase = useCallback(
    (passphrase: string) => {
      setBusy(true);
      setError(null);

      void (async () => {
        try {
          const material = await unlockWithPassphrase(passphrase);

          // A passphrase unlock on a device with no quick unlock yet is how the
          // fingerprint gets set up after a restore.
          if (material.slot === 'primary' && !(await isQuickUnlockEnabled())) {
            const biometrics = await biometricCapability();
            if (biometrics.available && biometrics.enrolled) {
              await enableQuickUnlock(material.dataKey).catch(() => undefined);
            }
          }

          await finishOpening(material);
        } catch (caught: unknown) {
          setError(
            caught instanceof Error ? caught.message : 'That passphrase did not work.',
          );
        } finally {
          setBusy(false);
        }
      })();
    },
    [finishOpening],
  );

  const unlockBiometric = useCallback(() => {
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        const material = await unlockWithBiometrics();
        // Undefined means cancelled or unavailable, not wrong: say nothing and
        // leave the passphrase route open.
        if (material) await finishOpening(material);
      } catch {
        setError('Fingerprint unlock failed. Use your passphrase.');
      } finally {
        setBusy(false);
      }
    })();
  }, [finishOpening]);

  const mutate = useCallback(
    <T,>(fn: (vault: OpenVault) => T): T | undefined => {
      if (state.status !== 'open') return undefined;
      const result = fn(state.vault);
      setVersion((current) => current + 1);
      void syncNotifications(state.vault).catch(() => undefined);
      // Let a burst of edits finish, then send them to the paired computer.
      syncComputerSoon(5000);
      return result;
    },
    [state, syncComputerSoon],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      busy,
      error,
      create,
      join,
      unlockPassphrase,
      unlockBiometric,
      version,
      mutate,
      computerSync,
      syncComputer,
    }),
    [state, busy, error, create, join, unlockPassphrase, unlockBiometric, version, mutate, computerSync, syncComputer],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside a VaultProvider.');
  return context;
}

/** For screens that only render once the vault is open. */
export function useOpenVault(): {
  vault: OpenVault;
  version: number;
  mutate: VaultContextValue['mutate'];
} {
  const { state, version, mutate } = useVault();
  if (state.status !== 'open') {
    throw new Error('This screen requires an open vault.');
  }
  return { vault: state.vault, version, mutate };
}
