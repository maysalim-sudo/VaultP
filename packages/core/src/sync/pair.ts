/**
 * Pairing two devices directly, over the network they are both already on.
 *
 * The computer keeps a small store of sync objects — the same encrypted
 * segments, files and keyfile a sync folder would hold — and answers four
 * questions about it: list, get, put, delete. The phone asks them. That is the
 * whole protocol, and it is the existing `StorageBackend` with a wire in the
 * middle, so nothing about how events merge had to change.
 *
 * WHAT TRAVELS, AND WHAT GUARDS IT. Everything in the store is already
 * ciphertext (or, for the keyfile, keys wrapped by the passphrase), so someone
 * listening on the Wi-Fi learns nothing readable. What they must not be able to
 * do is *talk* to the store — delete objects, or fill it with junk. So every
 * request and every reply carries an HMAC under a secret the two devices share,
 * and that secret only ever travels in the QR code: across the air between a
 * screen and a camera, never over the network it protects.
 *
 * Transport-agnostic on purpose. The functions here turn a request string into
 * a reply string; the desktop puts an HTTP server around one side and the phone
 * puts `fetch` around the other. That keeps the protocol testable with no
 * network at all, and keeps platform code out of core.
 */

import { bytesToUtf8, fromBase64, toBase64, utf8ToBytes } from '../crypto/base64.js';
import { hmacSha256, toHex } from '../crypto/sha256.js';
import type { SlotId } from '../crypto/keyfile.js';
import { type CryptoProvider, DecryptionError } from '../crypto/types.js';
import { X25519_KEY_LENGTH, type X25519KeyPair, openSealed, sealTo } from '../crypto/x25519.js';
import { ObjectNotFoundError, type RemoteObject, type StorageBackend } from './backend.js';
import { KEYFILE_KEY } from './segments.js';

export const PAIRING_VERSION = 1;
export const PAIRING_SCHEME = 'vaultp://pair';
export const PAIRING_SECRET_LENGTH = 32;

/** What the QR code says. */
export interface Pairing {
  /** `host:port` for every address the computer can be reached at. */
  readonly addresses: readonly string[];
  /** Shared secret, base64. Never sent over the network. */
  readonly secret: string;
  /** The computer's name, for "Paired with …". */
  readonly name: string;
  /**
   * Present when the computer is asking to be unlocked: a one-time public key
   * the phone seals the vault key to. Base64. See `handoff` below.
   */
  readonly handoffKey?: string;
}

export class PairingFormatError extends Error {
  constructor(message = 'That is not a VaultP pairing code.') {
    super(message);
    this.name = 'PairingFormatError';
  }
}

/** The reply did not come from the paired computer, or was altered on the way. */
export class PairingAuthError extends Error {
  constructor(message = 'The pairing was not accepted. Pair the devices again.') {
    super(message);
    this.name = 'PairingAuthError';
  }
}

const toUrlSafe = (value: string) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (value: string) => {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  return standard + '='.repeat((4 - (standard.length % 4)) % 4);
};

export function encodePairing(pairing: Pairing): string {
  const query = [
    `v=${PAIRING_VERSION}`,
    `a=${pairing.addresses.map(encodeURIComponent).join(',')}`,
    `s=${toUrlSafe(pairing.secret)}`,
    `n=${encodeURIComponent(pairing.name)}`,
    ...(pairing.handoffKey ? [`k=${toUrlSafe(pairing.handoffKey)}`] : []),
  ].join('&');
  return `${PAIRING_SCHEME}?${query}`;
}

export function parsePairing(text: string): Pairing {
  const trimmed = text.trim();
  if (!trimmed.startsWith(`${PAIRING_SCHEME}?`)) throw new PairingFormatError();

  const fields = new Map<string, string>();
  for (const part of trimmed.slice(PAIRING_SCHEME.length + 1).split('&')) {
    const at = part.indexOf('=');
    if (at > 0) fields.set(part.slice(0, at), part.slice(at + 1));
  }

  if (fields.get('v') !== String(PAIRING_VERSION)) {
    throw new PairingFormatError('This pairing code is from a different version of VaultP. Update both apps.');
  }

  const addresses = (fields.get('a') ?? '')
    .split(',')
    .map((address) => decodeURIComponent(address))
    .filter((address) => /^[\w.\-:[\]]+:\d{1,5}$/.test(address));
  const secret = fromUrlSafe(fields.get('s') ?? '');

  let secretBytes: Uint8Array;
  try {
    secretBytes = fromBase64(secret);
  } catch {
    throw new PairingFormatError();
  }
  if (addresses.length === 0 || secretBytes.length !== PAIRING_SECRET_LENGTH) throw new PairingFormatError();

  const name = decodeURIComponent(fields.get('n') ?? 'Computer');
  const k = fields.get('k');
  if (!k) return { addresses, secret, name };

  const handoffKey = fromUrlSafe(k);
  try {
    if (fromBase64(handoffKey).length !== X25519_KEY_LENGTH) throw new PairingFormatError();
  } catch {
    throw new PairingFormatError();
  }
  return { addresses, secret, name, handoffKey };
}

// ------------------------------------------------------------------- handoff
//
// Unlocking a computer from the phone. The phone is open (a fingerprint did
// that); the computer is not, and may not even have the vault yet. The phone
// hands over the data key and the keyfile, sealed to a public key the computer
// made for this one unlock and showed in its QR code.
//
// This is the one place a data key travels. It goes sealed to a key whose
// private half never leaves the computer's memory, so neither the network nor a
// photograph of the code yields it — and the phone asks for a fingerprint
// before sending.

const HANDOFF_CONTEXT = 'vaultp/handoff/v1';

export interface Handoff {
  readonly dataKey: Uint8Array;
  /** The phone's keyfile, so the computer can also be opened by passphrase. */
  readonly keyfile: string;
  /** Which of the keyfile's vaults the phone has open, so the same one opens here. */
  readonly slot: SlotId;
}

export async function sealHandoff(
  provider: CryptoProvider,
  handoffKey: string,
  handoff: Handoff,
): Promise<Uint8Array> {
  const body = JSON.stringify({
    v: 1,
    dataKey: toBase64(handoff.dataKey),
    keyfile: handoff.keyfile,
    slot: handoff.slot,
  });
  return sealTo(provider, fromBase64(handoffKey), utf8ToBytes(body), HANDOFF_CONTEXT);
}

export async function openHandoff(
  provider: CryptoProvider,
  recipient: X25519KeyPair,
  sealed: Uint8Array,
): Promise<Handoff> {
  const parsed = JSON.parse(bytesToUtf8(await openSealed(provider, recipient, sealed, HANDOFF_CONTEXT))) as {
    dataKey?: unknown;
    keyfile?: unknown;
    slot?: unknown;
  };
  if (typeof parsed.dataKey !== 'string' || typeof parsed.keyfile !== 'string') {
    throw new DecryptionError('The phone sent something this computer does not understand.');
  }
  return {
    dataKey: fromBase64(parsed.dataKey),
    keyfile: parsed.keyfile,
    slot: parsed.slot === 'decoy' ? 'decoy' : 'primary',
  };
}

// ------------------------------------------------------------------ envelope

interface Envelope {
  readonly v: number;
  /** Fresh per request; the reply echoes it, which ties the two together. */
  readonly n: string;
  /** The payload, as JSON text, exactly as signed. */
  readonly p: string;
  readonly m: string;
}

type Request =
  | { op: 'hello' }
  | { op: 'list'; prefix: string }
  | { op: 'get'; key: string }
  | { op: 'put'; key: string; data: string }
  | { op: 'delete'; key: string }
  | { op: 'handoff'; data: string };

type Reply =
  | { ok: true; name?: string; hasVault?: boolean; objects?: RemoteObject[]; data?: string }
  | { ok: false; error: 'not_found' | 'bad_request' | 'failed'; message?: string };

function mac(secret: Uint8Array, direction: 'q' | 'r', nonce: string, payload: string): string {
  return toHex(hmacSha256(secret, utf8ToBytes(`${direction}.${nonce}.${payload}`)));
}

/** Compare without stopping at the first difference, so timing says nothing. */
function sameMac(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function seal(secret: Uint8Array, direction: 'q' | 'r', nonce: string, payload: unknown): string {
  const p = JSON.stringify(payload);
  const envelope: Envelope = { v: PAIRING_VERSION, n: nonce, p, m: mac(secret, direction, nonce, p) };
  return JSON.stringify(envelope);
}

function open(secret: Uint8Array, direction: 'q' | 'r', text: string): { nonce: string; payload: unknown } | null {
  let envelope: Partial<Envelope>;
  try {
    envelope = JSON.parse(text) as Partial<Envelope>;
  } catch {
    return null;
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    typeof envelope.n !== 'string' ||
    typeof envelope.p !== 'string' ||
    typeof envelope.m !== 'string' ||
    !/^[0-9a-f]{16,64}$/.test(envelope.n)
  ) {
    return null;
  }
  if (!sameMac(envelope.m, mac(secret, direction, envelope.n, envelope.p))) return null;
  try {
    return { nonce: envelope.n, payload: JSON.parse(envelope.p) };
  } catch {
    return null;
  }
}

/** Object keys are paths within the store; nothing may climb out of it. */
function safeKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length < 512 &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    !key.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

// -------------------------------------------------------------------- server

export interface PairServerOptions {
  /** Where the sync objects live. On the desktop, a folder. */
  readonly backend: StorageBackend;
  /** The shared secret, as bytes. */
  readonly secret: Uint8Array;
  readonly name: string;
  /** Told after anything was written or removed, so the host can sync itself. */
  readonly onChange?: () => void;
  /**
   * The phone is handing over a sealed vault key. Resolves to null when it was
   * accepted, or to the reason it was not, which the phone shows.
   */
  readonly onHandoff?: (sealed: Uint8Array) => Promise<string | null>;
}

/** How many request nonces to remember; a repeat within these is a replay. */
const NONCE_MEMORY = 4096;

/**
 * Answer one request. Returns the reply text, or null when the request was not
 * signed by the paired device — which the transport should answer with a bare
 * refusal, saying nothing about why.
 */
export function createPairServer(options: PairServerOptions): (requestText: string) => Promise<string | null> {
  const seen = new Set<string>();

  return async (requestText) => {
    const opened = open(options.secret, 'q', requestText);
    if (!opened) return null;

    // A captured request sent again is refused. Requests are idempotent anyway —
    // objects are written once under unique names — so this is belt and braces.
    if (seen.has(opened.nonce)) return null;
    seen.add(opened.nonce);
    if (seen.size > NONCE_MEMORY) seen.delete(seen.values().next().value!);

    const reply = await answer(options, opened.payload as Request);
    return seal(options.secret, 'r', opened.nonce, reply);
  };
}

async function answer(options: PairServerOptions, request: Request): Promise<Reply> {
  const { backend } = options;
  try {
    switch (request?.op) {
      case 'hello': {
        const keyfile = await backend.list(KEYFILE_KEY);
        return { ok: true, name: options.name, hasVault: keyfile.some((object) => object.key === KEYFILE_KEY) };
      }
      case 'list':
        if (typeof request.prefix !== 'string' || request.prefix.includes('..')) return { ok: false, error: 'bad_request' };
        return { ok: true, objects: await backend.list(request.prefix) };
      case 'get':
        if (!safeKey(request.key)) return { ok: false, error: 'bad_request' };
        return { ok: true, data: toBase64(await backend.get(request.key)) };
      case 'put':
        if (!safeKey(request.key) || typeof request.data !== 'string') return { ok: false, error: 'bad_request' };
        await backend.put(request.key, fromBase64(request.data));
        options.onChange?.();
        return { ok: true };
      case 'delete':
        if (!safeKey(request.key)) return { ok: false, error: 'bad_request' };
        await backend.delete(request.key);
        options.onChange?.();
        return { ok: true };
      case 'handoff': {
        if (typeof request.data !== 'string') return { ok: false, error: 'bad_request' };
        if (!options.onHandoff) {
          return { ok: false, error: 'failed', message: 'The computer is not waiting to be unlocked. Show the code again.' };
        }
        const refusal = await options.onHandoff(fromBase64(request.data));
        return refusal === null ? { ok: true } : { ok: false, error: 'failed', message: refusal };
      }
      default:
        return { ok: false, error: 'bad_request' };
    }
  } catch (caught: unknown) {
    if (caught instanceof ObjectNotFoundError) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'failed', message: caught instanceof Error ? caught.message : String(caught) };
  }
}

// -------------------------------------------------------------------- client

export interface PairClientOptions {
  readonly secret: Uint8Array;
  /** Deliver a request to the paired computer and return its reply text. */
  readonly send: (requestText: string) => Promise<string>;
  /** Random bytes, for nonces. */
  readonly randomBytes: (length: number) => Uint8Array;
}

/** The paired computer's store, as a sync destination. */
export class PairBackend implements StorageBackend {
  constructor(private readonly options: PairClientOptions) {}

  private async call(request: Request): Promise<Extract<Reply, { ok: true }>> {
    const nonce = toHex(this.options.randomBytes(16));
    const replyText = await this.options.send(seal(this.options.secret, 'q', nonce, request));

    const opened = open(this.options.secret, 'r', replyText);
    // A reply that is unsigned, altered, or answers some other request.
    if (!opened || opened.nonce !== nonce) throw new PairingAuthError();

    const reply = opened.payload as Reply;
    if (reply.ok) return reply;
    if (reply.error === 'not_found') throw new ObjectNotFoundError('key' in request ? request.key : '');
    throw new Error(reply.message ?? 'The computer could not do that.');
  }

  /** Who is on the other end, and whether it already holds a vault to join. */
  async hello(): Promise<{ name: string; hasVault: boolean }> {
    const reply = await this.call({ op: 'hello' });
    return { name: reply.name ?? 'Computer', hasVault: reply.hasVault === true };
  }

  /** Hand a sealed vault key to the computer. Throws with its reason if refused. */
  async handoff(sealed: Uint8Array): Promise<void> {
    await this.call({ op: 'handoff', data: toBase64(sealed) });
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    return (await this.call({ op: 'list', prefix })).objects ?? [];
  }

  async get(key: string): Promise<Uint8Array> {
    return fromBase64((await this.call({ op: 'get', key })).data ?? '');
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.call({ op: 'put', key, data: toBase64(data) });
  }

  async delete(key: string): Promise<void> {
    await this.call({ op: 'delete', key });
  }
}
