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
  sealHandoff,
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
    // The usual cause, once both are on the same Wi-Fi, is Windows refusing the
    // connection — so the message says where the fix is.
    super(
      `Could not reach ${name}. Make sure VaultP is open on it and both devices are on the same Wi-Fi. ` +
        `If they are, Windows is probably blocking the phone: on the computer, open the code again and ` +
        `press “Let my phone connect”.`,
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

/**
 * Is VaultP listening here? An unsigned request is refused with 403, which is
 * exactly the answer that says so; anything else, including silence, is no.
 */
async function knock(address: string, timeoutMs: number): Promise<void> {
  await post(address, '{}', timeoutMs).catch((caught: unknown) => {
    if (!(caught instanceof PairingAuthError)) throw caught;
  });
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

      // Knock on every advertised address at once rather than one after another:
      // a computer with a virtual network adapter advertises addresses the phone
      // can never reach, and waiting out each in turn is what made a failed
      // connection take a minute. The knock is unsigned, so the real request is
      // still sent exactly once — to whichever address answered first.
      const answering = await Promise.any(
        known.map(async (address) => {
          await knock(address, CONNECT_TIMEOUT_MS);
          return address;
        }),
      ).catch(() => null);

      if (answering) {
        try {
          // Never so quick that a large upload is cut off: the allowance grows
          // with the body.
          const reply = await post(answering, body, CONNECT_TIMEOUT_MS + Math.ceil(body.length / 100));
          working = answering;
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
              await knock(address, SWEEP_TIMEOUT_MS);
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
export async function pairFromCode(code: string): Promise<{
  pairing: Pairing;
  backend: PairBackend;
  hasVault: boolean;
  /** Present when the computer is asking to be unlocked. */
  handoffKey?: string;
}> {
  const scanned = parsePairing(code);
  // The unlock key in a code is for that one unlock; only the lasting part of
  // the pairing is remembered.
  const { handoffKey, ...lasting } = scanned;
  const backend = backendFor(lasting, (addresses) => void savePairing({ ...lasting, addresses }));
  const hello = await backend.hello();
  const named = { ...lasting, name: hello.name || lasting.name };
  await savePairing(named);
  return {
    pairing: named,
    backend,
    hasVault: hello.hasVault,
    ...(handoffKey ? { handoffKey } : {}),
  };
}

/**
 * Unlock the paired computer: hand it this vault's key, sealed so that only
 * the computer showing the scanned code can open it.
 *
 * The caller has already asked for a fingerprint. This is the only place the
 * data key leaves the phone, and it leaves encrypted to a key whose private
 * half exists in that computer's memory alone.
 */
export async function unlockComputer(vault: OpenVault, backend: PairBackend, handoffKey: string): Promise<void> {
  const keyfile = await loadKeyfile();
  if (!keyfile) throw new Error('This phone has no vault to share.');

  const sealed = await sealHandoff(androidCryptoProvider, handoffKey, {
    dataKey: vault.dataKey,
    keyfile: serializeKeyfile(keyfile),
    slot: vault.slot,
  });
  await backend.handoff(sealed);
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
