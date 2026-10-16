/**
 * Pairing with a phone: this computer as the meeting point.
 *
 * The computer keeps a "hub" — a folder of sync objects exactly like a sync
 * folder, holding only ciphertext — and serves it to the paired phone over the
 * local network. The phone syncs against it over HTTP; this computer syncs
 * against it as the plain folder it is. Neither side learned a new way to sync:
 * the hub is one more place that can list, get, put and delete opaque blobs.
 *
 * WHY PLAIN HTTP IS ACCEPTABLE HERE. TLS on a home network means a certificate
 * nobody can verify, which is theatre. What actually protects the exchange is
 * in the protocol: every object is already encrypted, and every request and
 * reply is authenticated with a secret that only ever travelled in the QR code.
 * Someone on the same Wi-Fi can see that two devices are talking and how much —
 * the same they would see of any sync folder — and can neither read nor forge
 * any of it.
 *
 * The server runs whenever a pairing exists, locked vault or not: it serves
 * sealed bytes and needs no key to do so, and a phone should be able to hand
 * over the day's changes while this computer sits at its lock screen.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

import qrcode from 'qrcode-generator';

import {
  KEYFILE_KEY,
  PAIRING_SECRET_LENGTH,
  createPairServer,
  encodePairing,
  fromBase64,
  generateX25519KeyPair,
  openHandoff,
  toBase64,
  webCryptoProvider,
  type Handoff,
  type X25519KeyPair,
} from '@vaultp/core';

import type { PairingStatusDto } from '../shared/api.js';
import { FolderBackend } from './folderBackend.js';

const STATE_FILE = 'pairing.json';
const HUB_DIRECTORY = 'pair-hub';
/** Tried first; the next few are tried if something else already holds it. */
export const PREFERRED_PORT = 47821;
export const PORT_ATTEMPTS = 12;
/** A whole encrypted photo as base64 inside one request, with room to spare. */
const MAX_BODY_BYTES = 96 * 1024 * 1024;

interface PairingState {
  readonly secret: string;
  readonly createdAt: string;
}

let server: Server | undefined;
let port: number | undefined;
let state: PairingState | undefined;
let lastPhoneActivity: string | null = null;

/**
 * An unlock in progress: the key pair made for it, and what to do with the
 * vault key when the phone delivers it. In memory only, and only while the
 * code is on screen.
 */
interface PendingHandoff {
  readonly keyPair: X25519KeyPair;
  readonly expiresAt: number;
  readonly accept: (handoff: Handoff) => Promise<string | null>;
}
let pendingHandoff: PendingHandoff | undefined;

/** Long enough to find the phone and scan; short enough that a stale code is dead. */
const HANDOFF_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Start waiting for the phone to hand over the vault key.
 *
 * A fresh key pair every time: the private half exists only here, only until
 * the phone answers or the code is dismissed. `accept` opens the vault and
 * returns null, or returns the reason it could not — which the phone shows.
 */
export function beginHandoff(accept: (handoff: Handoff) => Promise<string | null>): void {
  pendingHandoff = {
    keyPair: generateX25519KeyPair(webCryptoProvider),
    expiresAt: Date.now() + HANDOFF_LIFETIME_MS,
    accept,
  };
}

export function cancelHandoff(): void {
  pendingHandoff = undefined;
}

/** The public half of the unlock in progress — what the QR code carries. */
export function handoffPublicKey(): string | undefined {
  return pendingHandoff && Date.now() <= pendingHandoff.expiresAt
    ? toBase64(pendingHandoff.keyPair.publicKey)
    : undefined;
}

async function receiveHandoff(sealed: Uint8Array): Promise<string | null> {
  const pending = pendingHandoff;
  if (!pending || Date.now() > pending.expiresAt) {
    pendingHandoff = undefined;
    return 'The code on the computer has expired. Close it and show a new one.';
  }

  let handoff: Handoff;
  try {
    handoff = await openHandoff(webCryptoProvider, pending.keyPair, sealed);
  } catch {
    return 'That was sealed for a different code. Scan the one on screen now.';
  }

  const refusal = await pending.accept(handoff);
  // One use: whether it worked or not, this key pair is finished.
  if (refusal === null) pendingHandoff = undefined;
  return refusal;
}

export function hubDirectory(root: string): string {
  return join(root, HUB_DIRECTORY);
}

async function loadState(root: string): Promise<PairingState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(root, STATE_FILE), 'utf8')) as Partial<PairingState>;
    if (typeof parsed.secret === 'string' && fromBase64(parsed.secret).length === PAIRING_SECRET_LENGTH) {
      return { secret: parsed.secret, createdAt: parsed.createdAt ?? new Date().toISOString() };
    }
  } catch {
    // No pairing yet, or an unreadable file: either way, not paired.
  }
  return undefined;
}

/** This computer's addresses on the networks a phone could share with it. */
/**
 * Adapters that exist only inside this computer — VirtualBox, Hyper-V and WSL,
 * VMware, Docker — or that lead to a VPN rather than the Wi-Fi. They look like
 * home networks (VirtualBox's is 192.168.56.x) but a phone can never reach them.
 */
const VIRTUAL_NAME = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|wireguard|loopback|npcap/i;
const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:15:5d|00:50:56|00:0c:29|00:05:69|00:1c:14|02:42)/i;

export function lanAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  const found: { ip: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const address of list ?? []) {
      // IPv4 only: it is what home routers hand out, and it keeps the QR small.
      // Link-local (169.254) means "no network", so it is not offered.
      if (address.family !== 'IPv4' || address.internal || address.address.startsWith('169.254.')) continue;
      const ip = address.address;
      const virtual =
        VIRTUAL_NAME.test(name) ||
        VIRTUAL_MAC.test(address.mac) ||
        ip.startsWith('192.168.56.') ||
        // 100.64/10 is carrier-grade NAT, which is where Tailscale lives.
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
      const home = ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
      // Virtual ones are still offered, last, in case a setup genuinely needs one.
      found.push({ ip, rank: (virtual ? 10 : 0) + home });
    }
  }
  // The phone knocks on all of them at once, but the order is still what it
  // remembers first.
  return found.sort((a, b) => a.rank - b.rank).map((entry) => entry.ip);
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(null));
  });
}

function listen(candidate: Server, onPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const failed = () => resolve(false);
    candidate.once('error', failed);
    candidate.listen(onPort, '0.0.0.0', () => {
      candidate.off('error', failed);
      resolve(true);
    });
  });
}

/**
 * Start serving the hub, if this computer is paired. Safe to call repeatedly.
 *
 * `onChange` fires after the phone wrote or removed something, so the open vault
 * can pull it in without anyone pressing Sync.
 */
export async function startPairing(root: string, onChange: () => void): Promise<void> {
  if (server) return;
  state = state ?? (await loadState(root));
  if (!state) return;

  await mkdir(hubDirectory(root), { recursive: true });
  const handle = createPairServer({
    backend: new FolderBackend(hubDirectory(root)),
    secret: fromBase64(state.secret),
    name: hostname(),
    onChange: () => {
      lastPhoneActivity = new Date().toISOString();
      onChange();
    },
    onHandoff: receiveHandoff,
  });

  const candidate = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      // One route. Anything else gets nothing to work with.
      if (request.method !== 'POST' || request.url !== '/v1') {
        response.writeHead(404).end();
        return;
      }
      const body = await readBody(request);
      const reply = body === null ? null : await handle(body);
      if (reply === null) {
        // Unsigned, altered or replayed: refused, with no detail about which.
        response.writeHead(403).end();
        return;
      }
      lastPhoneActivity = new Date().toISOString();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(reply);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    if (await listen(candidate, PREFERRED_PORT + attempt)) {
      server = candidate;
      port = PREFERRED_PORT + attempt;
      return;
    }
  }
  throw new Error('Could not open a port for pairing. Another program may be using them all.');
}

/** Create the pairing if there is none, and start serving. */
export async function ensurePairing(root: string, onChange: () => void): Promise<void> {
  state = state ?? (await loadState(root));
  if (!state) {
    state = {
      secret: toBase64(new Uint8Array(randomBytes(PAIRING_SECRET_LENGTH))),
      createdAt: new Date().toISOString(),
    };
    await mkdir(root, { recursive: true });
    await writeFile(join(root, STATE_FILE), JSON.stringify(state), 'utf8');
  }
  await startPairing(root, onChange);
}

/**
 * Forget the pairing: stop serving, discard the secret and the hub.
 *
 * The phone's copy of the secret stops working at once. Nothing of the vault is
 * lost — the hub only ever held copies of what both devices already have.
 */
export async function forgetPairing(root: string): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server?.closeAllConnections?.();
  server = undefined;
  port = undefined;
  state = undefined;
  lastPhoneActivity = null;
  pendingHandoff = undefined;
  await rm(join(root, STATE_FILE), { force: true });
  await rm(hubDirectory(root), { recursive: true, force: true });
}

export function isPaired(): boolean {
  return state !== undefined && server !== undefined;
}

/** The port being served on, once listening. */
export function pairingPort(): number | undefined {
  return port;
}

/** Whether the phone has left a vault in the hub for this computer to join. */
export async function hubHasVault(root: string): Promise<boolean> {
  const found = await new FolderBackend(hubDirectory(root)).list(KEYFILE_KEY);
  return found.some((object) => object.key === KEYFILE_KEY);
}

export async function pairingStatus(root: string): Promise<PairingStatusDto> {
  if (!state || !server || port === undefined) {
    return { paired: false, addresses: [], qr: null, hubHasVault: false, lastPhoneActivity: null };
  }

  const addresses = lanAddresses().map((ip) => `${ip}:${port}`);
  let qr: PairingStatusDto['qr'] = null;
  if (addresses.length > 0) {
    const code = qrcode(0, 'M');
    const unlocking = pendingHandoff && Date.now() <= pendingHandoff.expiresAt ? pendingHandoff : undefined;
    code.addData(
      encodePairing({
        addresses,
        secret: state.secret,
        name: hostname(),
        // While an unlock is being waited for, the code also carries the public
        // key to seal the vault key to.
        ...(unlocking ? { handoffKey: toBase64(unlocking.keyPair.publicKey) } : {}),
      }),
    );
    code.make();
    const size = code.getModuleCount();
    // The matrix itself, not markup: the window draws it, so no HTML crosses
    // the bridge.
    qr = {
      size,
      rows: Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => (code.isDark(row, column) ? '1' : '0')).join(''),
      ),
    };
  }

  return { paired: true, addresses, qr, hubHasVault: await hubHasVault(root), lastPhoneActivity };
}
