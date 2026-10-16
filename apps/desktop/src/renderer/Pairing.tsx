/**
 * The QR code dialogs: pairing a phone, and being unlocked by one.
 *
 * Two uses of the same code on screen.
 *
 *   pair     The vault is open here. The phone scans, and the two sync from
 *            then on.
 *   unlock   The vault is locked, or not here at all. The phone scans, asks for
 *            a fingerprint, and hands the vault key across — sealed to a key
 *            this computer made for that one unlock. No passphrase is typed.
 *
 * The code is drawn black on white whatever the theme, because that is what a
 * camera reads best.
 */

import { useEffect, useRef, useState } from 'react';

import type { NetworkAccessDto, PairingStatusDto } from '../shared/api.js';
import { Modal } from './Modal.js';
import { api, invalidate, messageOf } from './vault.js';

const QUIET_ZONE = 4;

export function QrCode({ qr, pixels = 256 }: { qr: NonNullable<PairingStatusDto['qr']>; pixels?: number }) {
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
      aria-label="A code to scan with VaultP on your phone."
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export function PairDialog({
  mode,
  onClose,
  onUnlocked,
}: {
  mode: 'pair' | 'unlock';
  onClose: () => void;
  /** Unlock mode: the phone handed over the key and the vault is open. */
  onUnlocked?: () => void;
}) {
  const [status, setStatus] = useState<PairingStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef(new Date().toISOString());
  const done = useRef(false);

  useEffect(() => {
    let live = true;
    const start = mode === 'unlock' ? api().startHandoff() : api().startPairing();
    void start
      .then((started) => live && setStatus(started))
      .catch((caught: unknown) => live && setError(messageOf(caught)));

    // The dialog cannot know when the phone scans, so it asks.
    const timer = setInterval(() => {
      void api()
        .pairingStatus()
        .then((next) => live && setStatus(next))
        .catch(() => undefined);

      if (mode === 'unlock') {
        void api()
          .status()
          .then((vault) => {
            if (live && vault.open && !done.current) {
              done.current = true;
              onUnlocked?.();
            }
          })
          .catch(() => undefined);
      }
    }, 1200);

    return () => {
      live = false;
      clearInterval(timer);
      // The one-time key dies with the dialog: a code no longer on screen must
      // not keep working.
      if (mode === 'unlock') void api().cancelHandoff().catch(() => undefined);
    };
    // Set up once per dialog; `onUnlocked` is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const [access, setAccess] = useState<NetworkAccessDto | null>(null);
  const [allowing, setAllowing] = useState(false);

  // Asked once per dialog: it takes Windows a second or two to answer, and the
  // answer only changes when someone changes it — usually with the button below.
  useEffect(() => {
    let live = true;
    void api()
      .networkAccess()
      .then((found) => live && setAccess(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function allow() {
    setAllowing(true);
    try {
      const after = await api().allowNetworkAccess();
      setAccess(after);
      if (after.state === 'blocked') {
        setError('Windows did not add the rule — the permission prompt may have been declined. Try again, or allow VaultP in Windows Security → Firewall.');
      } else {
        setError(null);
      }
    } catch (caught: unknown) {
      setError(messageOf(caught));
    } finally {
      setAllowing(false);
    }
  }

  const phoneSeen = status?.lastPhoneActivity != null && status.lastPhoneActivity >= openedAt.current;

  // Once the phone has synced into an open vault, every screen is stale.
  useEffect(() => {
    if (phoneSeen && mode === 'pair') invalidate();
  }, [phoneSeen, mode, status?.lastPhoneActivity]);

  return (
    <Modal title={mode === 'unlock' ? 'Unlock with your phone' : 'Pair with your phone'} onClose={onClose}>
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
              <strong>Sync with my computer</strong> → <strong>Scan the code</strong>.
            </li>
            <li>
              Point it at this code
              {mode === 'unlock' ? ', then confirm with your fingerprint.' : '.'}
            </li>
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
          {mode === 'unlock'
            ? 'Waiting for your phone… this code works once, for five minutes.'
            : phoneSeen
              ? '✓ Phone connected. The two will keep in step from now on.'
              : 'Waiting for the phone…'}
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {access?.state === 'blocked' && !phoneSeen ? (
        <div className="notice">
          <p>
            <strong>Windows will turn your phone away.</strong>{' '}
            {access.publicNetwork
              ? 'This Wi-Fi is marked as a public network, where Windows refuses incoming connections.'
              : 'Windows Firewall has no rule letting VaultP accept a connection.'}{' '}
            Allow it once and the phone can connect — only VaultP, only its sync ports, only from your local
            network.
          </p>
          <button disabled={allowing} onClick={() => void allow()}>
            {allowing ? 'Waiting for Windows…' : 'Let my phone connect'}
          </button>
          <p className="muted small">Windows will ask for permission to change its firewall.</p>
        </div>
      ) : null}

      <p className="muted small">
        {mode === 'unlock'
          ? 'Your phone sends the key encrypted so that only this computer, showing this code right now, can open it. '
          : ''}
        Nothing leaves your Wi-Fi.
        {status?.addresses.length ? ` Listening on ${status.addresses.join(', ')}.` : ''}
      </p>

      {mode === 'pair' && status?.paired ? (
        <div className="row">
          <span className="spacer" />
          <button
            className="danger"
            onClick={() => {
              if (
                !window.confirm(
                  'Unpair? The phone will stop syncing with this computer until you pair again. Nothing in your vault is deleted.',
                )
              ) {
                return;
              }
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
