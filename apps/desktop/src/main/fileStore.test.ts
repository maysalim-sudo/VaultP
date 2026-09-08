/**
 * The encrypted file store.
 *
 * These assertions are about the *format*, not just the round trip, because the
 * format is shared with the phone: `apps/mobile/src/documents/fileStore.ts`
 * writes the same relative path, derives the key the same way, and binds the
 * same additional data. If one side changes, the ciphertext stops being
 * interchangeable, and nothing else in the suite would notice.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveFileKey,
  deriveVaultKeys,
  sha256,
  toHex,
  webCryptoProvider,
  type StoredFile,
  type VaultKeys,
} from '@vaultp/core';

import { MissingFileError, decryptFile, deleteEncrypted, importFile } from './fileStore.js';

const directories: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vaultp-files-'));
  directories.push(directory);
  return directory;
}

async function keys(): Promise<VaultKeys> {
  return deriveVaultKeys(webCryptoProvider, new Uint8Array(32).fill(7));
}

/** The stored row `importFile` would have produced, as the repository holds it. */
function storedFile(id: string, encryptedPath: string): StoredFile {
  return {
    id,
    filename: 'passport.jpg',
    mime: 'image/jpeg',
    sizeBytes: null,
    sha256: null,
    encryptedPath,
    width: null,
    height: null,
  };
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('the encrypted file store', () => {
  it('round-trips a file through encryption', async () => {
    const root = await scratch();
    const vaultKeys = await keys();
    const plaintext = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);

    const source = join(root, 'source.jpg');
    await writeFile(source, plaintext);

    const imported = await importFile(root, vaultKeys, source);
    const recovered = await decryptFile(
      root,
      vaultKeys,
      storedFile(imported.id, imported.encryptedPath),
    );

    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
    expect(imported.sizeBytes).toBe(plaintext.length);
  });

  it('writes the ciphertext where the phone would look for it', async () => {
    const root = await scratch();
    const source = join(root, 'source.jpg');
    await writeFile(source, new Uint8Array([1, 2, 3]));

    const imported = await importFile(root, await keys(), source);

    // Forward slashes and this exact prefix: the field is a relative path both
    // platforms resolve against their own storage root.
    expect(imported.encryptedPath).toBe(`vault-files/${imported.id}.enc`);
    await expect(readFile(join(root, imported.encryptedPath))).resolves.toBeDefined();
  });

  it('hashes the plaintext, not the ciphertext', async () => {
    const root = await scratch();
    const plaintext = new Uint8Array([9, 8, 7, 6]);
    const source = join(root, 'source.jpg');
    await writeFile(source, plaintext);

    // Two imports of one file produce different ciphertext but the same hash,
    // which is what makes a duplicate scan detectable at all.
    const first = await importFile(root, await keys(), source);
    const second = await importFile(root, await keys(), source);

    expect(first.sha256).toBe(toHex(sha256(plaintext)));
    expect(second.sha256).toBe(first.sha256);
    expect(second.id).not.toBe(first.id);

    const one = await readFile(join(root, first.encryptedPath));
    const two = await readFile(join(root, second.encryptedPath));
    expect(one.equals(two)).toBe(false);
  });

  it('binds the ciphertext to its file id', async () => {
    const root = await scratch();
    const vaultKeys = await keys();
    const source = join(root, 'source.jpg');
    await writeFile(source, new Uint8Array([4, 5, 6]));

    const imported = await importFile(root, vaultKeys, source);
    const sealed = new Uint8Array(await readFile(join(root, imported.encryptedPath)));

    // The right key with the wrong additional data must fail. Without the
    // binding, ciphertext could be moved between records unnoticed.
    const fileKey = await deriveFileKey(webCryptoProvider, vaultKeys.files, imported.id);
    await expect(
      webCryptoProvider.decrypt(fileKey, sealed, 'vaultp/file/v1/someone-elses-id'),
    ).rejects.toThrow();
    await expect(
      webCryptoProvider.decrypt(fileKey, sealed, `vaultp/file/v1/${imported.id}`),
    ).resolves.toBeDefined();
  });

  it('says so plainly when the bytes are on the other device', async () => {
    const root = await scratch();
    // The record synced; the file did not. This is the ordinary case for a
    // document scanned on the phone, not a corruption.
    await expect(
      decryptFile(root, await keys(), storedFile('missing', 'vault-files/missing.enc')),
    ).rejects.toThrow(MissingFileError);
  });

  it('removes the bytes for real when a document is deleted', async () => {
    const root = await scratch();
    const source = join(root, 'source.jpg');
    await writeFile(source, new Uint8Array([1]));

    const imported = await importFile(root, await keys(), source);
    await deleteEncrypted(root, imported.encryptedPath);

    await expect(readFile(join(root, imported.encryptedPath))).rejects.toThrow();
    // Deleting what is already gone is not an error: the row may outlive the file.
    await expect(deleteEncrypted(root, imported.encryptedPath)).resolves.toBeUndefined();
  });
});
