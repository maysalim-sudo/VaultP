/**
 * The locked window.
 *
 * Two ways in, and neither is stored anywhere:
 *
 *   the passphrase   typed here, sent straight to the main process. It can be
 *                    shown while typing — a long passphrase typed blind is how
 *                    people come to believe they have forgotten it.
 *   the phone        scan a code, confirm with a fingerprint, and the phone
 *                    hands the key over. Nothing to remember at all.
 *
 * And a way out for when the passphrase really is gone: set this computer's
 * vault aside (moved, not deleted) and take the one on the phone instead.
 */

import { useState } from 'react';

import type { VaultStatus } from '../shared/api.js';
import { Modal } from './Modal.js';
import { PairDialog } from './Pairing.js';
import { api, messageOf, useRunner } from './vault.js';

export function Lock({
  status,
  onOpen,
  onStatus,
}: {
  status: VaultStatus;
  onOpen: () => void;
  /** The vault was set aside: there is no longer one here. */
  onStatus: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [visible, setVisible] = useState(false);
  const [withPhone, setWithPhone] = useState(false);
  const [forgot, setForgot] = useState(false);
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
            ? 'Unlock with your passphrase, or with your phone.'
            : 'Set this computer up, or bring the vault from your phone.'}
        </p>

        <PassphraseInput
          value={passphrase}
          visible={visible}
          onChange={setPassphrase}
          onToggle={() => setVisible((current) => !current)}
          placeholder={status.exists ? 'Passphrase' : 'Choose a passphrase'}
          autoFocus
          onEnter={() => {
            if (passphrase.length > 0) open(status.exists ? api().unlock : api().create)();
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

          {/* Needs nothing typed: the phone brings the key. */}
          <button className="secondary" disabled={busy} onClick={() => setWithPhone(true)}>
            {status.exists ? 'Unlock with my phone' : 'I already use VaultP on my phone'}
          </button>
        </div>

        {status.exists ? (
          <button className="link forgot" onClick={() => setForgot(true)}>
            Forgot the passphrase?
          </button>
        ) : (
          <>
            <p className="muted small">
              A fresh vault gives this computer its own key and will never merge with the phone. To use the vault
              already on your phone, choose “I already use VaultP on my phone” and scan the code it shows.
            </p>
            <details className="muted small">
              <summary>Other ways to join a vault</summary>
              <p>Both need the passphrase typed above first.</p>
              <div className="row">
                <button
                  className="secondary"
                  disabled={busy || passphrase.length === 0}
                  onClick={open(api().joinFolder)}
                >
                  Join from sync folder
                </button>
                <button className="secondary" disabled={busy || passphrase.length === 0} onClick={open(api().adopt)}>
                  Use a keyfile
                </button>
              </div>
            </details>
          </>
        )}

        {withPhone ? (
          <PairDialog
            mode="unlock"
            onClose={() => setWithPhone(false)}
            onUnlocked={() => {
              setWithPhone(false);
              setPassphrase('');
              onOpen();
            }}
          />
        ) : null}

        {forgot ? (
          <ForgotDialog
            onClose={() => setForgot(false)}
            onUsePhone={() => {
              setForgot(false);
              setWithPhone(true);
            }}
            onSetAside={() => {
              setForgot(false);
              setPassphrase('');
              onStatus();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

/** A passphrase field that can be looked at. */
export function PassphraseInput({
  value,
  visible,
  onChange,
  onToggle,
  onEnter,
  placeholder,
  autoFocus,
}: {
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  onEnter?: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="passphrase">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Shown or not, a passphrase is nothing the system should learn from.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEnter?.();
        }}
      />
      <button
        type="button"
        className="secondary eye"
        onClick={onToggle}
        aria-pressed={visible}
        aria-label={visible ? 'Hide the passphrase' : 'Show the passphrase'}
        title={visible ? 'Hide' : 'Show'}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function ForgotDialog({
  onClose,
  onUsePhone,
  onSetAside,
}: {
  onClose: () => void;
  onUsePhone: () => void;
  onSetAside: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null | undefined>(undefined);

  const setAside = () => {
    setBusy(true);
    setError(null);
    void api()
      .setVaultAside()
      .then((where) => setMoved(where ?? null))
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  if (moved !== undefined) {
    return (
      <Modal title="This computer is ready to start again" onClose={onSetAside}>
        <p>
          {moved
            ? 'The old vault was moved, not deleted. If its passphrase ever comes back to you, it can be put back.'
            : 'There was nothing here to move.'}
        </p>
        {moved ? <p className="muted small path-wrap">{moved}</p> : null}
        <p>
          Now choose <strong>I already use VaultP on my phone</strong> to bring your phone’s vault here, or create a new
          one.
        </p>
        <div className="row">
          <span className="spacer" />
          <button onClick={onSetAside}>Continue</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Forgot the passphrase?" onClose={onClose}>
      <p>
        Nobody can reset it — not even this app. That is what keeps the vault yours. But there are two ways forward.
      </p>

      <h3>If this vault is also on your phone</h3>
      <p className="muted">
        Your phone opens with your fingerprint and can unlock this computer for you. Nothing is lost.
      </p>
      <div className="row">
        <button onClick={onUsePhone}>Unlock with my phone</button>
      </div>

      <h3>If this computer has its own, separate vault</h3>
      <p className="muted">
        Without its passphrase it cannot be opened. You can set it aside and start again here — for instance with the
        vault from your phone. It is moved to a backup folder, not deleted, in case the passphrase comes back to you.
      </p>
      {confirming ? (
        <div className="row">
          <span className="warn">Set this computer’s vault aside?</span>
          <span className="spacer" />
          <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button className="danger" disabled={busy} onClick={setAside}>
            {busy ? 'Moving…' : 'Yes, start over here'}
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => setConfirming(true)}>
            Start over on this computer
          </button>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
