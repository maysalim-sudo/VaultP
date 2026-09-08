/**
 * The locked window.
 *
 * The passphrase is typed here and goes straight to the main process. It is not
 * stored, not remembered, and not defaulted — there is no route by which this
 * program could supply one on the user's behalf.
 */

import { useState } from 'react';

import type { VaultStatus } from '../shared/api.js';
import { api, useRunner } from './vault.js';

export function Lock({ status, onOpen }: { status: VaultStatus; onOpen: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const { busy, error, run } = useRunner();

  const open = (action: (passphrase: string) => Promise<unknown>) => () =>
    void run(async () => {
      const result = await action(passphrase);
      // A cancelled file or folder dialog returns nothing and is not a failure;
      // the window simply stays locked.
      if (result === undefined) return;
      setPassphrase('');
      onOpen();
    });

  return (
    <main className="centre">
      <div className="panel">
        <h1>VaultP</h1>
        <p className="muted">
          {status.exists
            ? 'Unlock with your passphrase.'
            : 'Set this computer up, or join the vault already on your phone.'}
        </p>

        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Passphrase"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && passphrase.length > 0) {
              open(status.exists ? api().unlock : api().create)();
            }
          }}
        />

        {error ? <p className="error">{error}</p> : null}

        <div className="row">
          <button
            disabled={busy || passphrase.length === 0}
            onClick={open(status.exists ? api().unlock : api().create)}
          >
            {status.exists ? 'Unlock' : 'Create vault'}
          </button>

          {status.exists ? null : (
            <>
              <button
                className="secondary"
                disabled={busy || passphrase.length === 0}
                onClick={open(api().joinFolder)}
              >
                Join from sync folder
              </button>
              <button
                className="secondary"
                disabled={busy || passphrase.length === 0}
                onClick={open(api().adopt)}
              >
                Use a keyfile
              </button>
            </>
          )}
        </div>

        {status.exists ? null : (
          <p className="muted small">
            A fresh vault gives this computer its own key and will never merge with the
            phone. To share one vault, sync once from the phone, then join from that same
            folder using the phone&apos;s passphrase.
          </p>
        )}
      </div>
    </main>
  );
}
