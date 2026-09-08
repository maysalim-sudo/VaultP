/**
 * Connecting the vault to a Google account.
 *
 * The credentials asked for here are the user's own. There is no client id in
 * this build: it is a public repository, which cannot hold one, and the app
 * promises not to hold an account with anybody — so a Drive backup runs through
 * the user's own Google Cloud project, on their own quota.
 */

import { useState } from 'react';

import { Field, Modal } from '../Modal.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

export function DriveSettings() {
  const status = useVaultQuery(() => api().driveStatus());
  const { busy, error, run } = useRunner();
  const [connecting, setConnecting] = useState(false);

  const connected = status.data?.connected === true;

  return (
    <>
      <h3>Google Drive</h3>

      {connected ? (
        <ul className="list">
          <li>
            <span>
              Connected
              <em className="muted"> · backing up to a Drive folder named </em>
              <strong>{status.data?.folderName}</strong>
              {status.data?.connectedAt ? (
                <>
                  <br />
                  <em className="muted small">
                    since {status.data.connectedAt.slice(0, 10)}
                  </em>
                </>
              ) : null}
            </span>
            <span className="right">
              <button
                className="link"
                disabled={busy}
                onClick={() => void run(() => api().disconnectDrive())}
              >
                disconnect
              </button>
            </span>
          </li>
        </ul>
      ) : (
        <p className="muted small">
          Not connected. The vault can back up to a folder in your Google Drive, using
          your own Google credentials — see the README for how to make them.
        </p>
      )}

      <div className="row">
        <button className="secondary" disabled={busy} onClick={() => setConnecting(true)}>
          {connected ? 'Connect a different account' : 'Connect Google Drive'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <p className="muted small">
        Only the folder this app creates is ever visible to it. The access it asks for
        cannot read anything else in your Drive, and what lands there is the same
        ciphertext a shared folder would receive — Google can no more read the vault than
        anyone else holding the files.
      </p>

      {connecting ? <ConnectForm onClose={() => setConnecting(false)} /> : null}
    </>
  );
}

function ConnectForm({ onClose }: { onClose: () => void }) {
  const { busy, error, run } = useRunner();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [folderName, setFolderName] = useState('VaultP');
  const [waiting, setWaiting] = useState(false);

  return (
    <Modal
      title="Connect Google Drive"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || clientId.trim() === ''}
            onClick={() =>
              void run(async () => {
                setWaiting(true);
                try {
                  await api().connectDrive({ clientId, clientSecret, folderName });
                  onClose();
                } finally {
                  setWaiting(false);
                }
              })
            }
          >
            {waiting ? 'Waiting for the browser…' : 'Sign in'}
          </button>
        </>
      }
    >
      <p className="muted small">
        Create an <strong>OAuth client ID</strong> of type <strong>Desktop app</strong> in
        your own Google Cloud project, with the Drive API enabled, then paste it here. The
        README has the steps.
      </p>

      <Field label="Client ID">
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
          autoFocus
        />
      </Field>

      <Field label="Client secret">
        <input
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          placeholder="Required for a Desktop app client"
        />
      </Field>

      <Field label="Folder name in your Drive">
        <input value={folderName} onChange={(event) => setFolderName(event.target.value)} />
      </Field>

      {waiting ? (
        <p className="muted small">
          A browser tab has opened. Finish signing in there; this window is waiting for it
          and will say when it is done.
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <p className="muted small">
        Both are stored inside the vault, encrypted under your passphrase. That is also
        why a locked vault cannot sync: nothing can reach them until you open it.
      </p>
    </Modal>
  );
}
