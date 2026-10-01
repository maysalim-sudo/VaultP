/**
 * Pairing with a phone: a QR code to scan, and nothing else to do.
 *
 * Two uses of the same dialog. With a vault open here, it is "add my phone":
 * scan, and the phone joins this vault (or starts syncing with it). With no
 * vault here yet, it is "I already use VaultP on my phone": scan, the phone
 * sends its vault across, and this computer joins it with the passphrase.
 *
 * The QR code carries this computer's address on the local network and a secret
 * the two devices will sign every message with. It is drawn black on white
 * whatever the theme, because that is what a camera reads best.
 */

import { useEffect, useRef, useState } from 'react';

import type { PairingStatusDto } from '../shared/api.js';
import { Modal } from './Modal.js';
import { api, invalidate, messageOf } from './vault.js';

const QUIET_ZONE = 4;

export function QrCode({ qr, pixels = 248 }: { qr: NonNullable<PairingStatusDto['qr']>; pixels?: number }) {
  const total = qr.size + QUIET_ZONE * 2;
  // One path for every dark module: far fewer nodes than a rect each.
  let path = '';
  qr.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '1') path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  });
  return (
    <svg
      className="qr"
      width={pixels}
      height={pixels}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pairing code. Scan it with VaultP on your phone."
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export function PairDialog({
  joining,
  onClose,
  onJoined,
}: {
  /** No vault on this computer yet: wait for the phone's, then join it. */
  joining: boolean;
  onClose: () => void;
  onJoined?: () => void;
}) {
  const [status, setStatus] = useState<PairingStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(new Date().toISOString());

  useEffect(() => {
    let live = true;
    void api()
      .startPairing()
      .then((started) => live && setStatus(started))
      .catch((caught: unknown) => live && setError(messageOf(caught)));

    // The dialog cannot know when the phone scans, so it asks: has the phone
    // talked to us yet, and (when joining) has its vault arrived?
    const timer = setInterval(() => {
      void api()
        .pairingStatus()
        .then((next) => live && setStatus(next))
        .catch(() => undefined);
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const phoneSeen = status?.lastPhoneActivity != null && status.lastPhoneActivity >= openedAt.current;
  const vaultArrived = joining && status?.hubHasVault === true;

  // Once the phone has synced into an open vault, every screen is stale.
  useEffect(() => {
    if (phoneSeen && !joining) invalidate();
  }, [phoneSeen, joining, status?.lastPhoneActivity]);

  const join = () => {
    setBusy(true);
    setError(null);
    void api()
      .joinPair(passphrase)
      .then(() => {
        setPassphrase('');
        onJoined?.();
      })
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={joining ? 'Bring your vault from your phone' : 'Pair with your phone'} onClose={onClose}>
      {status === null && !error ? <p className="muted">Getting ready…</p> : null}

      {status && status.qr ? (
        <div className="pair">
          <QrCode qr={status.qr} />
          <ol className="pair-steps">
            <li>
              Make sure your phone is on the <strong>same Wi-Fi</strong> as this computer.
            </li>
            <li>
              On the phone, open VaultP → <strong>Backup &amp; sync</strong> →{' '}
              <strong>Sync with my computer</strong> → <strong>Scan the code</strong>
              {joining ? '' : ' (on a new phone, choose “I already use VaultP on my computer” instead)'}.
            </li>
            <li>Point it at this code.</li>
          </ol>
        </div>
      ) : null}

      {status && status.paired && !status.qr ? (
        <p className="warn">
          This computer is not connected to a network, so the phone has nowhere to reach it. Join your Wi-Fi and open
          this again.
        </p>
      ) : null}

      {status?.qr ? (
        <p className={`pair-state ${phoneSeen ? 'ok' : ''}`}>
          {vaultArrived
            ? '✓ Your phone’s vault has arrived. Enter its passphrase to open it here.'
            : phoneSeen
              ? joining
                ? '✓ Phone connected — receiving your vault…'
                : '✓ Phone connected. The two will keep in step from now on.'
              : 'Waiting for the phone…'}
        </p>
      ) : null}

      {vaultArrived ? (
        <div className="row">
          <input
            type="password"
            autoFocus
            value={passphrase}
            placeholder="The passphrase you use on the phone"
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && passphrase.length > 0 && !busy) join();
            }}
          />
          <button disabled={busy || passphrase.length === 0} onClick={join}>
            {busy ? 'Opening…' : 'Open vault'}
          </button>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <p className="muted small">
        Windows may ask to allow VaultP on your network the first time — choose <strong>Allow</strong>, or the phone
        cannot reach it. Everything that crosses is already encrypted, and nothing leaves your Wi-Fi.
        {status?.addresses.length ? ` Listening on ${status.addresses.join(', ')}.` : ''}
      </p>

      {!joining && status?.paired ? (
        <div className="row">
          <span className="spacer" />
          <button
            className="danger"
            onClick={() => {
              if (!window.confirm('Unpair? The phone will stop syncing with this computer until you pair again. Nothing in your vault is deleted.')) return;
              void api()
                .forgetPairing()
                .then(() => {
                  invalidate();
                  onClose();
                })
                .catch((caught: unknown) => setError(messageOf(caught)));
            }}
          >
            Unpair
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
