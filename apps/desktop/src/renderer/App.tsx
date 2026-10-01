/**
 * The desktop window.
 *
 * Deliberately not a copy of the phone. The phone is built for logging a coffee
 * in three taps; a desktop has a keyboard, a big screen and a mouse, so entry is
 * typed and the space goes to seeing things side by side.
 *
 * It holds no state that matters. Everything is asked of the main process, which
 * owns the vault.
 */

import { useEffect, useState } from 'react';

import type { SyncTarget, VaultStatus } from '../shared/api.js';
import { Lock } from './Lock.js';
import { PairDialog } from './Pairing.js';
import { Sidebar, type ScreenId } from './Sidebar.js';
import { Dashboard } from './screens/Dashboard.js';
import { Debts } from './screens/Debts.js';
import { Documents } from './screens/Documents.js';
import { Expenses } from './screens/Expenses.js';
import { Notes } from './screens/Notes.js';
import { Rules } from './screens/Rules.js';
import { Search } from './screens/Search.js';
import { Settings } from './screens/Settings.js';
import { api, invalidate, useRunner, useVaultQuery } from './vault.js';

const SCREEN_BODIES: Record<ScreenId, () => React.ReactElement> = {
  dashboard: Dashboard,
  expenses: Expenses,
  rules: Rules,
  debts: Debts,
  documents: Documents,
  notes: Notes,
  search: Search,
  settings: Settings,
};

export function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [screen, setScreen] = useState<ScreenId>('dashboard');

  useEffect(() => {
    void api().status().then(setStatus);
  }, []);

  if (status === null) return <main className="centre">Loading…</main>;

  if (!status.open) {
    return (
      <Lock
        status={status}
        onOpen={() => {
          setStatus({ ...status, open: true });
          // Joining a folder also sets one, so the header learns about it.
          void api().status().then(setStatus);
        }}
        onStatus={() => void api().status().then(setStatus)}
      />
    );
  }

  const Body = SCREEN_BODIES[screen];

  return (
    <div className="shell">
      <Sidebar current={screen} onSelect={setScreen} />
      <main className="page">
        <SyncBar
          folder={status.syncFolder}
          target={status.syncTarget}
          onFolder={(folder) => setStatus({ ...status, syncFolder: folder })}
          onTarget={(syncTarget) => setStatus({ ...status, syncTarget })}
        />
        <Body />
      </main>
    </div>
  );
}

function SyncBar({
  folder,
  target,
  onFolder,
  onTarget,
}: {
  folder: string | undefined;
  target: SyncTarget;
  onFolder: (folder: string | undefined) => void;
  onTarget: (target: SyncTarget) => void;
}) {
  const { busy, error, run } = useRunner();
  const drive = useVaultQuery(() => api().driveStatus());
  const pairing = useVaultQuery(() => api().pairingStatus());
  const [report, setReport] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);

  const driveReady = drive.data?.connected === true;
  const paired = pairing.data?.paired === true;
  const ready = target === 'drive' ? driveReady : target === 'pair' ? paired : folder !== undefined;

  return (
    <div className="syncbar">
      <select
        value={target}
        onChange={(event) =>
          void run(async () => {
            const chosen = event.target.value as SyncTarget;
            await api().setSyncTarget(chosen);
            onTarget(chosen);
          })
        }
      >
        <option value="pair">Sync with my phone</option>
        <option value="folder">Sync to a folder</option>
        <option value="drive">Sync to Google Drive</option>
      </select>

      {target === 'pair' ? (
        <button className="secondary" onClick={() => setPairingOpen(true)}>
          {paired ? 'Pairing code' : 'Pair a phone'}
        </button>
      ) : null}

      {target === 'folder' ? (
        <button
          className="secondary"
          onClick={() => void run(async () => onFolder(await api().chooseSyncFolder()))}
        >
          {folder ? 'Change folder' : 'Choose sync folder'}
        </button>
      ) : null}
      <button
        disabled={busy || !ready}
        onClick={() =>
          void run(async () => {
            const result = await api().sync();
            const files =
              result.uploadedFiles + result.downloadedFiles + result.removedFiles > 0
                ? `, files ↑${result.uploadedFiles} ↓${result.downloadedFiles}`
                : '';
            setReport(
              `pushed ${result.pushedEvents}, pulled ${result.pulledEvents}, new ${result.appliedEvents}${files}`,
            );
            // A sync can bring in anything the phone did, so every screen is stale.
            invalidate();
          })
        }
      >
        Sync
      </button>
      {target === 'folder' && folder ? (
        <span className="muted small path">{folder}</span>
      ) : null}
      {target === 'drive' ? (
        <span className="muted small">
          {driveReady
            ? `Drive · ${drive.data?.folderName ?? ''}`
            : 'Connect an account in Settings'}
        </span>
      ) : null}
      {target === 'pair' ? (
        <span className="muted small">
          {paired ? 'Paired — syncs by itself while both are on the same Wi-Fi' : 'Scan a code with the phone to pair'}
        </span>
      ) : null}
      {report ? <span className="muted small">{report}</span> : null}
      {error ? <span className="error small">{error}</span> : null}

      {pairingOpen ? (
        <PairDialog
          mode="pair"
          onClose={() => {
            setPairingOpen(false);
            // Pairing also makes the phone the sync target; reflect it here.
            void api()
              .status()
              .then((next) => onTarget(next.syncTarget));
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
