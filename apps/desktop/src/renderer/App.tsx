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

import { useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { VaultStatus } from '../shared/api.js';
import { Lock } from './Lock.js';
import { NavContext, type Intent, type Navigation } from './nav.js';
import { GlobalSearch } from './GlobalSearch.js';
import { Icon, type IconName } from './icons.js';
import { Modal } from './Modal.js';
import { MONEY, SCREENS, Sidebar, type ScreenId } from './Sidebar.js';
import { Accounts } from './screens/Accounts.js';
import { Dashboard } from './screens/Dashboard.js';
import { Debts } from './screens/Debts.js';
import { Documents } from './screens/Documents.js';
import { Expenses } from './screens/Expenses.js';
import { Notes } from './screens/Notes.js';
import { Rules } from './screens/Rules.js';
import { Settings } from './screens/Settings.js';
import { SyncContext, SyncPill, type SyncState } from './Sync.js';
import { api } from './vault.js';

const SCREEN_BODIES: Record<ScreenId, () => React.ReactElement> = {
  dashboard: Dashboard,
  notes: Notes,
  expenses: Expenses,
  rules: Rules,
  debts: Debts,
  accounts: Accounts,
  documents: Documents,
  settings: Settings,
};

export function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [screen, setScreen] = useState<ScreenId>('dashboard');
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const pending = useRef<{ screen: ScreenId; intent: Intent } | null>(null);

  const nav = useMemo<Navigation>(
    () => ({
      screen,
      version,
      go(next, intent) {
        pending.current = intent ? { screen: next, intent } : null;
        setScreen(next);
        setVersion((current) => current + 1);
      },
      take(asking) {
        const waiting = pending.current;
        if (!waiting || waiting.screen !== asking) return null;
        pending.current = null;
        return waiting.intent;
      },
    }),
    [screen, version],
  );

  useEffect(() => {
    void api().status().then(setStatus);
  }, []);

  // Ctrl+N opens the create sheet from anywhere the vault is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n' && status?.open) {
        event.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status?.open]);

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
  const synced =
    status.syncTarget === 'folder' ? status.syncFolder !== undefined : status.syncTarget !== undefined;

  const sync: SyncState = {
    folder: status.syncFolder,
    target: status.syncTarget,
    setFolder: (folder) => setStatus({ ...status, syncFolder: folder }),
    setTarget: (syncTarget) => setStatus({ ...status, syncTarget }),
  };

  return (
    <NavContext.Provider value={nav}>
      <SyncContext.Provider value={sync}>
        <div className="shell">
          <Sidebar
            current={screen}
            synced={synced}
            onSelect={(next) => nav.go(next)}
            onCreate={() => setCreating(true)}
          />
          <main className="page">
            <div className="page-inner">
              <div className="topbar">
                <GlobalSearch />
                <SyncPill />
              </div>
              {MONEY.includes(screen) ? <MoneyTabs current={screen} onSelect={(next) => nav.go(next)} /> : null}
              <Body />
            </div>
          </main>
        </div>
        {creating ? <CreateSheet onClose={() => setCreating(false)} /> : null}
      </SyncContext.Provider>
    </NavContext.Provider>
  );
}

/** Money's four parts, as the tabs at the top of each. */
function MoneyTabs({ current, onSelect }: { current: ScreenId; onSelect: (id: ScreenId) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="Money">
      {MONEY.map((id) => (
        <button key={id} role="tab" aria-selected={id === current} onClick={() => onSelect(id)}>
          {SCREENS.find((screen) => screen.id === id)!.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/**
 * Everything that can be made, one click away. An expense is the common case,
 * so it gets the wide orange tile.
 */
function CreateSheet({ onClose }: { onClose: () => void }) {
  const nav = useContext(NavContext)!;
  const items: ReadonlyArray<{ t: string; m: string; icon: IconName; go: () => void }> = [
    { t: 'Expense', m: 'Amount, category, how you paid', icon: 'receipt', go: () => nav.go('expenses', { kind: 'newExpense' }) },
    { t: 'Note', m: 'Text, tables, images', icon: 'notes', go: () => nav.go('notes', { kind: 'newNote', with: 'text' }) },
    { t: 'Checklist', m: 'Ticked items drop to the end', icon: 'checklist', go: () => nav.go('notes', { kind: 'newNote', with: 'checklist' }) },
    { t: 'Person', m: 'Lent, borrowed, paid back', icon: 'people', go: () => nav.go('debts', { kind: 'newPerson' }) },
    { t: 'Document', m: 'A scan, read on this computer', icon: 'scan', go: () => nav.go('documents', { kind: 'newDocument' }) },
  ];
  return (
    <Modal title="New" onClose={onClose}>
      <div className="create-grid">
        {items.map((item, index) => (
          <button
            key={item.t}
            className={index === 0 ? 'first' : ''}
            autoFocus={index === 0}
            onClick={() => {
              onClose();
              item.go();
            }}
          >
            <Icon name={item.icon} size={22} />
            <span>
              <strong>{item.t}</strong>
              <small>{item.m}</small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
