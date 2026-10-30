/**
 * Syncing: a pill in the top bar, the controls in Settings.
 *
 * The pill says where the vault syncs and whether that is set up, and syncs on
 * a click. Choosing the target, a folder, pairing a phone — things done once —
 * live in Settings, so they stop taking the top of every page.
 */

import { createContext, useContext, useState } from 'react';

import type { SyncTarget } from '../shared/api.js';
import { useNav } from './nav.js';
import { PairDialog } from './Pairing.js';
import { api, invalidate, useRunner, useVaultQuery } from './vault.js';

export interface SyncState {
  readonly folder: string | undefined;
  readonly target: SyncTarget;
  setFolder(folder: string | undefined): void;
  setTarget(target: SyncTarget): void;
}

export const SyncContext = createContext<SyncState | null>(null);

function useSync(): SyncState {
  const sync = useContext(SyncContext);
  if (!sync) throw new Error('useSync outside the window shell.');
  return sync;
}

/** Where it syncs, whether that works yet, and what the last run did. */
function useSyncStatus() {
  const { folder, target } = useSync();
  const drive = useVaultQuery(() => api().driveStatus());
  const pairing = useVaultQuery(() => api().pairingStatus());
  const driveReady = drive.data?.connected === true;
  const paired = pairing.data?.paired === true;
  const ready = target === 'drive' ? driveReady : target === 'pair' ? paired : folder !== undefined;
  const where = target === 'drive' ? 'DRIVE' : target === 'pair' ? 'PHONE' : 'FOLDER';
  return { ready, where, driveReady, paired, driveFolder: drive.data?.folderName ?? '' };
}

function useSyncNow() {
  const { busy, error, run } = useRunner();
  const [report, setReport] = useState<string | null>(null);
  const syncNow = () =>
    void run(async () => {
      const result = await api().sync();
      const files =
        result.uploadedFiles + result.downloadedFiles + result.removedFiles > 0
          ? `, files ↑${result.uploadedFiles} ↓${result.downloadedFiles}`
          : '';
      setReport(`Pushed ${result.pushedEvents}, pulled ${result.pulledEvents}, new ${result.appliedEvents}${files}`);
      // A sync can bring in anything the phone did, so every screen is stale.
      invalidate();
    });
  return { busy, error, report, syncNow };
}

export function SyncPill() {
  const nav = useNav();
  const { ready, where } = useSyncStatus();
  const { busy, error, report, syncNow } = useSyncNow();

  return (
    <div className="sync-pill" title={error ?? report ?? undefined}>
      <span className={`sync-dot ${ready ? 'ok' : ''}`} />
      <span className="label">{ready ? `${where} · READY` : 'SYNC NOT SET UP'}</span>
      {ready ? (
        <button disabled={busy} onClick={syncNow}>
          {busy ? 'Syncing…' : 'Sync'}
        </button>
      ) : (
        <button className="secondary" onClick={() => nav.go('settings')}>
          Set up
        </button>
      )}
      {error ? <span className="error small">{error}</span> : null}
    </div>
  );
}

export function SyncSetup() {
  const { folder, target, setFolder, setTarget } = useSync();
  const { ready, paired, driveReady, driveFolder } = useSyncStatus();
  const { busy, error, report, syncNow } = useSyncNow();
  const choose = useRunner();
  const [pairingOpen, setPairingOpen] = useState(false);

  const targets: ReadonlyArray<readonly [SyncTarget, string]> = [
    ['pair', 'MY PHONE'],
    ['folder', 'A FOLDER'],
    ['drive', 'GOOGLE DRIVE'],
  ];

  const detail =
    target === 'pair'
      ? paired
        ? 'Paired. Syncs by itself while both are on the same Wi-Fi.'
        : 'Scan a code with the phone to pair.'
      : target === 'folder'
        ? (folder ?? 'Choose a folder that something else keeps in step: Syncthing, a shared drive, a stick.')
        : driveReady
          ? `Drive · ${driveFolder}`
          : 'Connect an account below first.';

  return (
    <div className="sync-setup">
      <div className="label-row">
        <span className="label">SYNC</span>
        <span className={`label ${ready ? 'pos' : 'warn'}`}>{ready ? 'READY' : 'NOT SET UP'}</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Sync with" style={{ margin: 0 }}>
        {targets.map(([value, label]) => (
          <button
            key={value}
            role="radio"
            aria-checked={value === target}
            aria-selected={value === target}
            onClick={() =>
              void choose.run(async () => {
                await api().setSyncTarget(value);
                setTarget(value);
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      <p className="sub path-wrap" style={{ margin: 0 }}>
        {detail}
      </p>
      <div className="row">
        {target === 'pair' ? (
          <button className="secondary" onClick={() => setPairingOpen(true)}>
            {paired ? 'Show the pairing code' : 'Pair a phone'}
          </button>
        ) : null}
        {target === 'folder' ? (
          <button
            className="secondary"
            onClick={() => void choose.run(async () => setFolder(await api().chooseSyncFolder()))}
          >
            {folder ? 'Change folder' : 'Choose a folder'}
          </button>
        ) : null}
        <button disabled={busy || !ready} onClick={syncNow}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
        {report ? <span className="muted small">{report}</span> : null}
        {error || choose.error ? <span className="error small">{error ?? choose.error}</span> : null}
      </div>

      {pairingOpen ? (
        <PairDialog
          mode="pair"
          onClose={() => {
            setPairingOpen(false);
            // Pairing also makes the phone the sync target; reflect it here.
            void api()
              .status()
              .then((next) => setTarget(next.syncTarget));
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
