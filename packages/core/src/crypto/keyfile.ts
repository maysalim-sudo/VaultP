/**
 * The keyfile: how a passphrase opens a vault.
 *
 *   passphrase --KDF(slot salt)--> KEK --unwraps--> DK --HKDF--> db / file / oplog keys
 *
 * The data key (DK) is random and never derived from the passphrase, so changing
 * the passphrase rewraps one 32-byte value instead of re-encrypting the entire
 * vault. The passphrase is the only recovery path: it is what a new device uses to
 * bootstrap from cloud storage, and losing it loses the data. That is the intended
 * property, not an oversight.
 *
 * The keyfile holds only wrapped keys and public parameters, so it is safe to
 * store next to the encrypted backups.
 */

import { fromBase64, toBase64, utf8ToBytes } from './base64.js';
import {
  type CryptoProvider,
  DEFAULT_KDF,
  DecryptionError,
  KEY_LENGTH,
  type KdfParams,
  MIN_PASSPHRASE_LENGTH,
  SALT_LENGTH,
  WeakPassphraseError,
} from './types.js';

export const KEYFILE_VERSION = 1;

/** Real vault, and the decoy the panic passphrase opens. */
export type SlotId = 'primary' | 'decoy';
export const SLOT_IDS: readonly SlotId[] = ['primary', 'decoy'];

export interface KeySlot {
  readonly id: SlotId;
  /** Per-slot, so two slots never share a derived key even with equal passphrases. */
  readonly salt: string;
  /** nonce || ciphertext || tag, base64. */
  readonly wrapped: string;
}

export interface Keyfile {
  readonly version: number;
  /** Random identifier, bound into the AAD so slots cannot be swapped between vaults. */
  readonly id: string;
  readonly kdf: KdfParams;
  readonly slots: readonly KeySlot[];
}

export interface UnlockResult {
  /** Which vault the passphrase opened. `decoy` means the panic passphrase was used. */
  readonly slot: SlotId;
  /** The root data key. Keep in memory only. */
  readonly dataKey: Uint8Array;
}

export class KeyfileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyfileFormatError';
  }
}

export class InvalidDataKeyError extends Error {
  constructor(length: number) {
    super(`A data key must be exactly ${KEY_LENGTH} bytes; got ${length}.`);
    this.name = 'InvalidDataKeyError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not open this vault.');
    this.name = 'WrongPassphraseError';
  }
}

/**
 * Binds a wrapped key to one slot of one keyfile.
 *
 * Without this, an attacker holding the file could copy the decoy slot's wrapped
 * key over the primary slot; the app would then open the decoy while believing it
 * had opened the real vault.
 */
function aadFor(keyfileId: string, slot: SlotId): string {
  return `vaultp/keyfile/v${KEYFILE_VERSION}/${keyfileId}/${slot}`;
}

function assertStrongEnough(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new WeakPassphraseError(MIN_PASSPHRASE_LENGTH);
  }
}

async function wrap(
  provider: CryptoProvider,
  keyfileId: string,
  slot: SlotId,
  passphrase: string,
  dataKey: Uint8Array,
  kdf: KdfParams,
): Promise<KeySlot> {
  const salt = provider.randomBytes(SALT_LENGTH);
  const kek = await provider.deriveFromPassphrase(passphrase, salt, kdf, KEY_LENGTH);
  const wrapped = await provider.encrypt(kek, dataKey, aadFor(keyfileId, slot));
  return { id: slot, salt: toBase64(salt), wrapped: toBase64(wrapped) };
}

export interface CreateVaultOptions {
  readonly passphrase: string;
  /**
   * Opens a second, empty vault. Optional — but a slot is always written either
   * way, filled with an unguessable random passphrase when none is given, so the
   * keyfile looks identical whether or not a decoy is in use.
   */
  readonly decoyPassphrase?: string;
  readonly kdf?: KdfParams;
  /**
   * Wrap an existing data key instead of generating one.
   *
   * The migration path: a vault whose key was only ever held in the device
   * keystore can be given a passphrase without re-encrypting anything, because
   * the key itself does not change — only what guards it.
   */
  readonly dataKey?: Uint8Array;
}

export interface CreatedVault {
  readonly keyfile: Keyfile;
  readonly dataKey: Uint8Array;
  readonly decoyDataKey: Uint8Array;
}

export async function createVault(
  provider: CryptoProvider,
  options: CreateVaultOptions,
): Promise<CreatedVault> {
  assertStrongEnough(options.passphrase);
  if (options.decoyPassphrase !== undefined) {
    assertStrongEnough(options.decoyPassphrase);
    if (options.decoyPassphrase === options.passphrase) {
      throw new WeakPassphraseError(MIN_PASSPHRASE_LENGTH);
    }
  }

  const kdf = options.kdf ?? DEFAULT_KDF;
  const keyfileId = toBase64(provider.randomBytes(12));
  const dataKey = options.dataKey ?? provider.randomBytes(KEY_LENGTH);
  if (dataKey.length !== KEY_LENGTH) throw new InvalidDataKeyError(dataKey.length);
  const decoyDataKey = provider.randomBytes(KEY_LENGTH);

  // An unused decoy still gets a real slot with a random passphrase nobody knows.
  // If the slot were omitted, the file itself would reveal that no decoy exists.
  const decoyPassphrase =
    options.decoyPassphrase ?? toBase64(provider.randomBytes(32));

  const slots = await Promise.all([
    wrap(provider, keyfileId, 'primary', options.passphrase, dataKey, kdf),
    wrap(provider, keyfileId, 'decoy', decoyPassphrase, decoyDataKey, kdf),
  ]);

  return {
    keyfile: { version: KEYFILE_VERSION, id: keyfileId, kdf, slots },
    dataKey,
    decoyDataKey,
  };
}

/**
 * Try the passphrase against every slot.
 *
 * All slots are always attempted, and in a fixed order, so the work done does not
 * depend on which one matches — a decoy that could be detected by how quickly the
 * app responded would be no decoy at all.
 */
export async function unlockVault(
  provider: CryptoProvider,
  keyfile: Keyfile,
  passphrase: string,
): Promise<UnlockResult> {
  assertKeyfile(keyfile);

  let found: UnlockResult | undefined;

  for (const slot of keyfile.slots) {
    const salt = fromBase64(slot.salt);
    const kek = await provider.deriveFromPassphrase(
      passphrase,
      salt,
      keyfile.kdf,
      KEY_LENGTH,
    );
    try {
      const dataKey = await provider.decrypt(
        kek,
        fromBase64(slot.wrapped),
        aadFor(keyfile.id, slot.id),
      );
      found ??= { slot: slot.id, dataKey };
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
    }
  }

  if (!found) throw new WrongPassphraseError();
  return found;
}

/** Rewrap one slot under a new passphrase. The data key, and the data, are untouched. */
export async function changePassphrase(
  provider: CryptoProvider,
  keyfile: Keyfile,
  slot: SlotId,
  dataKey: Uint8Array,
  newPassphrase: string,
  kdf: KdfParams = keyfile.kdf,
): Promise<Keyfile> {
  assertStrongEnough(newPassphrase);
  const replacement = await wrap(provider, keyfile.id, slot, newPassphrase, dataKey, kdf);
  return {
    ...keyfile,
    kdf,
    slots: keyfile.slots.map((existing) =>
      existing.id === slot ? replacement : existing,
    ),
  };
}

export function serializeKeyfile(keyfile: Keyfile): string {
  return JSON.stringify(keyfile, null, 2);
}

export function parseKeyfile(text: string): Keyfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KeyfileFormatError('Keyfile is not valid JSON.');
  }
  assertKeyfile(parsed);
  return parsed;
}

export function assertKeyfile(value: unknown): asserts value is Keyfile {
  if (typeof value !== 'object' || value === null) {
    throw new KeyfileFormatError('Keyfile is not an object.');
  }
  const keyfile = value as Partial<Keyfile>;
  if (keyfile.version !== KEYFILE_VERSION) {
    throw new KeyfileFormatError(
      `Keyfile version ${String(keyfile.version)} is not supported by this build ` +
        `(expected ${KEYFILE_VERSION}).`,
    );
  }
  if (typeof keyfile.id !== 'string' || keyfile.id === '') {
    throw new KeyfileFormatError('Keyfile is missing its id.');
  }
  if (typeof keyfile.kdf !== 'object' || keyfile.kdf === null) {
    throw new KeyfileFormatError('Keyfile is missing KDF parameters.');
  }
  if (!Array.isArray(keyfile.slots) || keyfile.slots.length === 0) {
    throw new KeyfileFormatError('Keyfile has no key slots.');
  }
  for (const slot of keyfile.slots) {
    if (
      typeof slot?.id !== 'string' ||
      typeof slot.salt !== 'string' ||
      typeof slot.wrapped !== 'string'
    ) {
      throw new KeyfileFormatError('Keyfile contains a malformed slot.');
    }
  }
}

/** Bytes covered by the AAD, exposed for tests that assert the binding. */
export function aadBytes(keyfileId: string, slot: SlotId): Uint8Array {
  return utf8ToBytes(aadFor(keyfileId, slot));
}
