/**
 * The desktop vault: the same core, a different set of platform parts.
 *
 * Everything that decides what is true — money, merges, balances, sync ordering —
 * comes from `@vaultp/core` and is the identical code the phone runs. Only the
 * database driver, the file locations and the crypto primitives differ. That is
 * the whole reason the two devices can agree.
 */

import { app } from 'electron';
import { basename, dirname, join } from 'node:path';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import {
  AccountRepository,
  DebtRepository,
  DriveBackend,
  DocumentRepository,
  ExpenseRepository,
  NoteRepository,
  SyncEngine,
  fetchKeyfileFrom,
  VaultStore,
  createVault,
  deriveVaultKeys,
  newDeviceId,
  parseKeyfile,
  serializeKeyfile,
  toSqlCipherKey,
  unlockVault,
  webCryptoProvider,
  type Keyfile,
  type SlotId,
  type StorageBackend,
  type SyncReport,
  type VaultKeys,
} from '@vaultp/core';

import { openDesktopDatabase } from './db.js';
import { connection, driveAuthFor } from './driveAuth.js';
import { desktopFileStore } from './fileStore.js';
import { FolderBackend } from './folderBackend.js';

const DATABASE_NAME = 'vaultp.db';
const DECOY_DATABASE_NAME = 'vaultp-decoy.db';
const KEYFILE_NAME = 'keyfile.json';
const DEVICE_NAME = 'device-id';

export interface DesktopVault {
  readonly store: VaultStore;
  readonly expenses: ExpenseRepository;
  readonly debts: DebtRepository;
  readonly documents: DocumentRepository;
  readonly notes: NoteRepository;
  readonly accounts: AccountRepository;
  readonly keys: VaultKeys;
  readonly slot: SlotId;
  readonly deviceId: string;
}

function dataDirectory(): string {
  return app.getPath('userData');
}

async function readText(name: string): Promise<string | undefined> {
  try {
    return await readFile(join(dataDirectory(), name), 'utf8');
  } catch {
    return undefined;
  }
}

async function writeText(name: string, contents: string): Promise<void> {
  await mkdir(dataDirectory(), { recursive: true });
  await writeFile(join(dataDirectory(), name), contents, 'utf8');
}

export async function hasVault(): Promise<boolean> {
  return (await readText(KEYFILE_NAME)) !== undefined;
}

async function deviceId(): Promise<string> {
  const existing = await readText(DEVICE_NAME);
  if (existing) return existing.trim();

  const created = newDeviceId();
  await writeText(DEVICE_NAME, created);
  return created;
}

/**
 * Create this device's vault.
 *
 * A second device shares this vault in one of two ways. Either it is given the
 * keyfile and the passphrase unwraps it — the key itself never moves — or an
 * already-open phone hands the key over directly (`openFromHandoff`), sealed to
 * a one-time key this computer generated and after a fingerprint on the phone.
 * There is no third route, and nothing that sends a key in a form the network
 * or a bystander could use.
 */
export async function createDesktopVault(passphrase: string): Promise<DesktopVault> {
  const created = await createVault(webCryptoProvider, { passphrase });
  await writeText(KEYFILE_NAME, serializeKeyfile(created.keyfile));
  return openWith(created.dataKey, 'primary');
}

/** Adopt a keyfile written by the phone, so both devices share one data key. */
export async function adoptKeyfile(serialized: string, passphrase: string): Promise<DesktopVault> {
  const keyfile: Keyfile = parseKeyfile(serialized);
  const opened = await unlockVault(webCryptoProvider, keyfile, passphrase);
  await writeText(KEYFILE_NAME, serializeKeyfile(keyfile));
  return openWith(opened.dataKey, opened.slot);
}

export async function unlockDesktopVault(passphrase: string): Promise<DesktopVault> {
  const serialized = await readText(KEYFILE_NAME);
  if (!serialized) throw new Error('No vault on this computer yet.');

  const opened = await unlockVault(webCryptoProvider, parseKeyfile(serialized), passphrase);
  return openWith(opened.dataKey, opened.slot);
}

export class DifferentVaultError extends Error {
  constructor() {
    super(
      'This computer already holds a different vault, so the phone’s key does not open it. ' +
        'To use the phone’s vault here, choose “Forgot the passphrase?” on the computer and start over.',
    );
    this.name = 'DifferentVaultError';
  }
}

/**
 * Open the vault with a key handed over by the phone.
 *
 * Two cases. This computer has no vault: it adopts the phone's keyfile and
 * starts empty, to be filled by sync. Or it has one: then it must be the same
 * vault — the same keyfile id — or the phone's key is simply the wrong key,
 * and saying so beats opening a database that turns out to be noise.
 *
 * Adopting the keyfile matters beyond this unlock: it is what lets the
 * passphrase open this computer too, if it is ever remembered.
 */
export async function openFromHandoff(handoff: {
  dataKey: Uint8Array;
  keyfile: string;
  slot: SlotId;
}): Promise<DesktopVault> {
  const theirs = parseKeyfile(handoff.keyfile);
  const existing = await readText(KEYFILE_NAME);

  if (existing) {
    if (parseKeyfile(existing).id !== theirs.id) throw new DifferentVaultError();
  } else {
    await writeText(KEYFILE_NAME, serializeKeyfile(theirs));
  }
  return openWith(handoff.dataKey, handoff.slot);
}

/** Everything that makes up this computer's copy of a vault. */
const VAULT_ENTRIES = [
  KEYFILE_NAME,
  DATABASE_NAME,
  `${DATABASE_NAME}-wal`,
  `${DATABASE_NAME}-shm`,
  DECOY_DATABASE_NAME,
  `${DECOY_DATABASE_NAME}-wal`,
  `${DECOY_DATABASE_NAME}-shm`,
  DEVICE_NAME,
  'vault-files',
];

/**
 * Start over on this computer: set its vault aside, so it can take another.
 *
 * Moved, never deleted. A vault whose passphrase is forgotten cannot be opened
 * today, but passphrases come back to people, and a deleted vault does not.
 * The folder sits beside the app's data, named for the moment it was made.
 *
 * Returns where it went, or undefined if there was nothing to move.
 */
export async function setVaultAside(): Promise<string | undefined> {
  const root = dataDirectory();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = join(dirname(root), `${basename(root)}-old-vault-${stamp}`);

  let moved = 0;
  for (const entry of VAULT_ENTRIES) {
    try {
      await access(join(root, entry));
    } catch {
      continue;
    }
    await mkdir(backup, { recursive: true });
    await rename(join(root, entry), join(backup, entry));
    moved += 1;
  }
  return moved > 0 ? backup : undefined;
}

async function openWith(dataKey: Uint8Array, slot: SlotId): Promise<DesktopVault> {
  const keys = await deriveVaultKeys(webCryptoProvider, dataKey);
  await mkdir(dataDirectory(), { recursive: true });

  const db = openDesktopDatabase({
    path: join(dataDirectory(), slot === 'decoy' ? DECOY_DATABASE_NAME : DATABASE_NAME),
    encryptionKey: toSqlCipherKey(keys.database),
  });

  const store = VaultStore.open({ db, device: await deviceId() });

  return {
    store,
    expenses: new ExpenseRepository(store),
    debts: new DebtRepository(store),
    documents: new DocumentRepository(store),
    notes: new NoteRepository(store),
    accounts: new AccountRepository(store),
    keys,
    slot,
    deviceId: store.device,
  };
}

/**
 * Join a vault that already exists, using the keyfile the phone left in the
 * sync folder.
 *
 * The data key is random, not derived from the passphrase, so two devices cannot
 * arrive at the same one independently. One of them has to hand it over — wrapped,
 * which is what the keyfile is.
 */
export async function joinFromFolder(
  folder: string,
  passphrase: string,
): Promise<DesktopVault | undefined> {
  const serialized = await fetchKeyfileFrom(new FolderBackend(folder));
  if (!serialized) return undefined;

  return adoptKeyfile(serialized, passphrase);
}

/**
 * Sync against whatever storage was chosen.
 *
 * A folder and a Drive account are the same thing to everything above this
 * line: four operations over opaque, already-encrypted blobs. That is why
 * adding Drive changed nothing about how events merge or how files travel.
 */
export function syncWith(vault: DesktopVault, backend: StorageBackend): Promise<SyncReport> {
  const engine = new SyncEngine({
    store: vault.store,
    backend,
    provider: webCryptoProvider,
    oplogKey: vault.keys.oplog,
    // Carries the scans as well as the records. The bytes go across already
    // sealed, so the destination gains nothing readable by handling them.
    files: desktopFileStore(dataDirectory()),
  });

  return engine.sync();
}

export function syncWithFolder(vault: DesktopVault, folder: string): Promise<SyncReport> {
  return syncWith(vault, new FolderBackend(folder));
}

/**
 * Sync against the pairing hub, leaving this vault's keyfile there first.
 *
 * The keyfile is what lets a newly paired phone join with the passphrase alone.
 * It holds only wrapped keys, and the hub is on this computer's own disk.
 */
export async function syncWithHub(vault: DesktopVault, hub: string): Promise<SyncReport> {
  const engine = new SyncEngine({
    store: vault.store,
    backend: new FolderBackend(hub),
    provider: webCryptoProvider,
    oplogKey: vault.keys.oplog,
    files: desktopFileStore(dataDirectory()),
  });

  const keyfile = await readText(KEYFILE_NAME);
  if (keyfile) await engine.publishKeyfile(keyfile);
  return engine.sync();
}

/** The Drive backend for this vault, or undefined when no account is connected. */
export async function driveBackendFor(
  vault: DesktopVault,
): Promise<DriveBackend | undefined> {
  const status = await connection(vault.store, vault.keys);
  if (!status.connected) return undefined;

  return new DriveBackend({
    auth: driveAuthFor(vault.store, vault.keys),
    folderName: status.folderName,
  });
}
