/**
 * The phone's side of pairing with a computer.
 *
 * What was scanned from the QR code — the computer's addresses and the shared
 * secret — is kept in the Android Keystore-backed secure store, on this device
 * only. It is deliberately not a vault setting: settings sync, and a pairing
 * secret that synced to the computer it is meant to authenticate against would
 * be circular at best.
 *
 * Reaching the computer is plain HTTP on the local network; see the note in
 * core's `sync/pair.ts` for why that is sound. This file's job is the
 * unglamorous part: trying each address the computer advertised, remembering
 * the one that answered, and — when the router has since handed the computer a
 * different address — looking for it nearby rather than asking for a re-scan.
 */

import * as SecureStore from 'expo-secure-store';

import {
  PairBackend,
  PairingAuthError,
  SyncEngine,
  fromBase64,
  parsePairing,
  serializeKeyfile,
  type Pairing,
  type SyncReport,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';
import { phoneFileStore } from '../documents/fileStore.js';
import { loadKeyfile } from '../vault/keys.js';
import type { OpenVault } from '../vault/open.js';

const PAIRING_ITEM = 'vaultp.pairing.v1';

/** Long enough for a sleepy laptop on Wi-Fi, short enough to try the next address. */
const CONNECT_TIMEOUT_MS = 3500;
/** A large encrypted photo on a slow link. */
const TRANSFER_TIMEOUT_MS = 120_000;
const SWEEP_TIMEOUT_MS = 700;

export class ComputerUnreachableError extends Error {
  constructor(name: string) {
    super(
      `Could not reach ${name}. Make sure VaultP is open on it and both devices are on the same Wi-Fi.`,
    );
    this.name = 'ComputerUnreachableError';
  }
}

export async function loadPairing(): Promise<Pairing | undefined> {
  const stored = await SecureStore.getItemAsync(PAIRING_ITEM);
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as Pairing;
    return Array.isArray(parsed.addresses) && typeof parsed.secret === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function savePairing(pairing: Pairing): Promise<void> {
  await SecureStore.setItemAsync(PAIRING_ITEM, JSON.stringify(pairing), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function forgetPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_ITEM);
}

async function post(address: string, body: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${address}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    // 403 is the computer saying "not signed by my phone": the pairing is gone.
    if (response.status === 403) throw new PairingAuthError();
    if (!response.ok) throw new Error(`The computer answered ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Every other host on the same /24 as a known address, same port. */
function neighbours(address: string): string[] {
  const match = /^(\d+\.\d+\.\d+)\.(\d+):(\d+)$/.exec(address);
  if (!match) return [];
  const [, subnet, host, port] = match;
  const found: string[] = [];
  for (let last = 1; last < 255; last += 1) {
    if (String(last) !== host) found.push(`${subnet}.${last}:${port}`);
  }
  return found;
}

/**
 * A sync destination that talks to the paired computer.
 *
 * `onAddress` is told when the computer was found somewhere new, so the next
 * launch goes straight there.
 */
function backendFor(pairing: Pairing, onAddress: (addresses: string[]) => void): PairBackend {
  let known = [...pairing.addresses];
  let working: string | null = null;

  const backend: PairBackend = new PairBackend({
    secret: fromBase64(pairing.secret),
    randomBytes: (length) => androidCryptoProvider.randomBytes(length),
    send: async (body) => {
      if (working) {
        try {
          return await post(working, body, TRANSFER_TIMEOUT_MS);
        } catch (caught) {
          if (caught instanceof PairingAuthError) throw caught;
          working = null;
        }
      }

      for (const address of known) {
        try {
          // Quick to give up on an address that is not there, but never so quick
          // that a large upload is cut off: the allowance grows with the body.
          const reply = await post(address, body, CONNECT_TIMEOUT_MS + Math.ceil(body.length / 100));
          working = address;
          return reply;
        } catch (caught) {
          if (caught instanceof PairingAuthError) throw caught;
        }
      }

      // The router may have moved it. Knock on the neighbouring addresses; only
      // the paired computer can produce a reply this request's signature check
      // will accept, so a stranger answering on that port changes nothing.
      for (const candidate of known.slice(0, 2)) {
        const hosts = neighbours(candidate);
        for (let index = 0; index < hosts.length; index += 32) {
          const batch = hosts.slice(index, index + 32);
          const found = await Promise.any(
            batch.map(async (address) => {
              await post(address, '{}', SWEEP_TIMEOUT_MS).catch((caught: unknown) => {
                // A 403 to an unsigned knock is exactly what VaultP answers.
                if (!(caught instanceof PairingAuthError)) throw caught;
              });
              return address;
            }),
          ).catch(() => null);

          if (found) {
            try {
              const reply = await post(found, body, TRANSFER_TIMEOUT_MS);
              working = found;
              known = [found, ...known.filter((address) => address !== found)];
              onAddress(known);
              return reply;
            } catch (caught) {
              if (caught instanceof PairingAuthError) throw caught;
            }
          }
        }
      }

      throw new ComputerUnreachableError(pairing.name);
    },
  });
  return backend;
}

/** The paired computer as a sync destination, or undefined when not paired. */
export async function computerBackend(): Promise<{ backend: PairBackend; pairing: Pairing } | undefined> {
  const pairing = await loadPairing();
  if (!pairing) return undefined;
  return {
    pairing,
    backend: backendFor(pairing, (addresses) => void savePairing({ ...pairing, addresses })),
  };
}

/**
 * Pair from a scanned code: check the computer really answers, then remember it.
 *
 * Returns what the computer said about itself — notably whether it already
 * holds a vault, which decides what happens next on a phone with none.
 */
export async function pairFromCode(code: string): Promise<{ pairing: Pairing; backend: PairBackend; hasVault: boolean }> {
  const pairing = parsePairing(code);
  const backend = backendFor(pairing, (addresses) => void savePairing({ ...pairing, addresses }));
  const hello = await backend.hello();
  const named = { ...pairing, name: hello.name || pairing.name };
  await savePairing(named);
  return { pairing: named, backend, hasVault: hello.hasVault };
}

let running: Promise<SyncReport | undefined> | null = null;

/**
 * Sync this vault with the paired computer.
 *
 * One at a time: a sync started while another is running joins it rather than
 * racing it. Resolves to undefined when the phone is not paired.
 */
export function syncWithComputer(vault: OpenVault): Promise<SyncReport | undefined> {
  if (running) return running;

  running = (async () => {
    const computer = await computerBackend();
    if (!computer) return undefined;

    const engine = new SyncEngine({
      store: vault.store,
      backend: computer.backend,
      provider: androidCryptoProvider,
      oplogKey: vault.keys.oplog,
      files: phoneFileStore(),
    });

    // Leave the keyfile on the computer, so one that has no vault yet can join
    // this one with the passphrase alone. It holds only wrapped keys.
    const keyfile = await loadKeyfile();
    if (keyfile) await engine.publishKeyfile(serializeKeyfile(keyfile));

    return engine.sync();
  })().finally(() => {
    running = null;
  });

  return running;
}
