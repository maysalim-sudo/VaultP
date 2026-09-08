import { describe, expect, it } from 'vitest';
import { bytesToUtf8, fromBase64, toBase64, utf8ToBytes } from './base64.js';
import {
  KeyfileFormatError,
  WrongPassphraseError,
  changePassphrase,
  createVault,
  parseKeyfile,
  serializeKeyfile,
  unlockVault,
} from './keyfile.js';
import { deriveFileKey, deriveVaultKeys, toSqlCipherKey, wipe } from './subkeys.js';
import { DecryptionError, WeakPassphraseError } from './types.js';
import { webCryptoProvider as provider } from './webcrypto.js';

const PASSPHRASE = 'correct horse battery staple';
const DECOY = 'open sesame please now';

/** PBKDF2 at production strength is slow by design; tests use a lower count. */
const FAST_KDF = { algorithm: 'PBKDF2-SHA512', iterations: 1000 } as const;

function newVault(decoyPassphrase?: string) {
  return createVault(provider, {
    passphrase: PASSPHRASE,
    kdf: FAST_KDF,
    ...(decoyPassphrase === undefined ? {} : { decoyPassphrase }),
  });
}

describe('base64 and utf8', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [0, 1, 2, 3, 16, 31, 32, 255]) {
      const bytes = provider.randomBytes(length);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips text including Arabic, French and emoji', () => {
    for (const text of ['hello', 'مرحبا', 'café à Tunis', '🔐 vault', '']) {
      expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
    }
  });

  it('rejects invalid base64', () => {
    expect(() => fromBase64('not valid!')).toThrow(/Invalid base64/);
  });
});

describe('creating a vault', () => {
  it('produces a keyfile holding only wrapped keys', () => {
    return newVault().then(({ keyfile, dataKey }) => {
      const serialized = serializeKeyfile(keyfile);
      // The data key must not appear anywhere in the file that sits in the cloud.
      expect(serialized).not.toContain(toBase64(dataKey));
      expect(serialized).not.toContain(PASSPHRASE);
      expect(keyfile.slots.map((s) => s.id)).toEqual(['primary', 'decoy']);
    });
  });

  it('always writes a decoy slot, even when no decoy is configured', async () => {
    const without = await newVault();
    const with_ = await newVault(DECOY);

    // The file looks the same either way; an absent slot would itself reveal that
    // no decoy exists, which would defeat the purpose of having one.
    expect(without.keyfile.slots).toHaveLength(2);
    expect(with_.keyfile.slots).toHaveLength(2);
    expect(without.keyfile.slots.map((s) => s.id)).toEqual(
      with_.keyfile.slots.map((s) => s.id),
    );
  });

  it('gives each slot its own salt', async () => {
    const { keyfile } = await newVault(DECOY);
    const [primary, decoy] = keyfile.slots;
    expect(primary?.salt).not.toBe(decoy?.salt);
  });

  it('generates a different data key for every vault', async () => {
    const a = await newVault();
    const b = await newVault();
    expect(toBase64(a.dataKey)).not.toBe(toBase64(b.dataKey));
  });

  it('refuses a short passphrase', async () => {
    await expect(
      createVault(provider, { passphrase: 'short', kdf: FAST_KDF }),
    ).rejects.toThrow(WeakPassphraseError);
  });

  it('refuses a decoy passphrase identical to the real one', async () => {
    await expect(
      createVault(provider, {
        passphrase: PASSPHRASE,
        decoyPassphrase: PASSPHRASE,
        kdf: FAST_KDF,
      }),
    ).rejects.toThrow(WeakPassphraseError);
  });
});

describe('unlocking', () => {
  it('recovers the exact data key from the passphrase alone', async () => {
    const { keyfile, dataKey } = await newVault();
    const opened = await unlockVault(provider, keyfile, PASSPHRASE);

    expect(opened.slot).toBe('primary');
    expect(toBase64(opened.dataKey)).toBe(toBase64(dataKey));
  });

  it('opens the decoy vault with the decoy passphrase', async () => {
    const { keyfile, dataKey, decoyDataKey } = await newVault(DECOY);
    const opened = await unlockVault(provider, keyfile, DECOY);

    expect(opened.slot).toBe('decoy');
    expect(toBase64(opened.dataKey)).toBe(toBase64(decoyDataKey));
    expect(toBase64(opened.dataKey)).not.toBe(toBase64(dataKey));
  });

  it('rejects a wrong passphrase', async () => {
    const { keyfile } = await newVault(DECOY);
    await expect(unlockVault(provider, keyfile, 'wrong passphrase here')).rejects.toThrow(
      WrongPassphraseError,
    );
  });

  it('survives a round trip through JSON', async () => {
    const { keyfile, dataKey } = await newVault();
    const reloaded = parseKeyfile(serializeKeyfile(keyfile));
    const opened = await unlockVault(provider, reloaded, PASSPHRASE);
    expect(toBase64(opened.dataKey)).toBe(toBase64(dataKey));
  });

  it('refuses a keyfile from a future version', () => {
    expect(() => parseKeyfile(JSON.stringify({ version: 99, id: 'x', kdf: {}, slots: [] })))
      .toThrow(KeyfileFormatError);
  });

  it('refuses a corrupted keyfile', () => {
    expect(() => parseKeyfile('{ not json')).toThrow(KeyfileFormatError);
    expect(() => parseKeyfile(JSON.stringify({ version: 1, id: 'x', kdf: {}, slots: [] })))
      .toThrow(/no key slots/);
  });
});

describe('tamper resistance', () => {
  it('rejects a wrapped key moved from the decoy slot into the primary slot', async () => {
    const { keyfile } = await newVault(DECOY);
    const decoy = keyfile.slots.find((s) => s.id === 'decoy')!;

    // Without the slot binding in the AAD, this swap would make the app open the
    // decoy while believing it had opened the real vault.
    const tampered = {
      ...keyfile,
      slots: keyfile.slots.map((slot) =>
        slot.id === 'primary' ? { ...slot, salt: decoy.salt, wrapped: decoy.wrapped } : slot,
      ),
    };

    const opened = await unlockVault(provider, tampered, DECOY);
    expect(opened.slot).toBe('decoy');
  });

  it('rejects a keyfile whose id was changed', async () => {
    const { keyfile } = await newVault();
    const tampered = { ...keyfile, id: 'someone-elses-vault' };
    await expect(unlockVault(provider, tampered, PASSPHRASE)).rejects.toThrow(
      WrongPassphraseError,
    );
  });

  it('rejects ciphertext with a flipped bit', async () => {
    const key = provider.randomBytes(32);
    const sealed = await provider.encrypt(key, utf8ToBytes('sensitive'), 'aad');
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 1;

    await expect(provider.decrypt(key, sealed, 'aad')).rejects.toThrow(DecryptionError);
  });

  it('rejects ciphertext decrypted with the wrong associated data', async () => {
    const key = provider.randomBytes(32);
    const sealed = await provider.encrypt(key, utf8ToBytes('sensitive'), 'context-a');
    await expect(provider.decrypt(key, sealed, 'context-b')).rejects.toThrow(
      DecryptionError,
    );
  });

  it('never reuses a nonce', async () => {
    const key = provider.randomBytes(32);
    const message = utf8ToBytes('same message every time');
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(toBase64((await provider.encrypt(key, message, 'aad')).subarray(0, 12)));
    }
    expect(seen.size).toBe(50);
  });
});

describe('changing the passphrase', () => {
  it('rewraps without touching the data key, so nothing is re-encrypted', async () => {
    const { keyfile, dataKey } = await newVault();
    const updated = await changePassphrase(
      provider,
      keyfile,
      'primary',
      dataKey,
      'a brand new passphrase',
      FAST_KDF,
    );

    const opened = await unlockVault(provider, updated, 'a brand new passphrase');
    expect(toBase64(opened.dataKey)).toBe(toBase64(dataKey));

    await expect(unlockVault(provider, updated, PASSPHRASE)).rejects.toThrow(
      WrongPassphraseError,
    );
  });

  it('leaves the decoy slot working', async () => {
    const { keyfile, dataKey, decoyDataKey } = await newVault(DECOY);
    const updated = await changePassphrase(
      provider,
      keyfile,
      'primary',
      dataKey,
      'another good passphrase',
      FAST_KDF,
    );

    const opened = await unlockVault(provider, updated, DECOY);
    expect(toBase64(opened.dataKey)).toBe(toBase64(decoyDataKey));
  });
});

describe('subkeys', () => {
  it('derives independent keys, none of them the data key', async () => {
    const { dataKey } = await newVault();
    const keys = await deriveVaultKeys(provider, dataKey);

    const distinct = new Set(
      [keys.database, keys.files, keys.oplog, keys.credentials, dataKey].map(toBase64),
    );
    expect(distinct.size).toBe(5);
    expect(keys.database).toHaveLength(32);
    expect(keys.credentials).toHaveLength(32);
  });

  it('is deterministic, so a new device reproduces the same keys', async () => {
    const { dataKey } = await newVault();
    const first = await deriveVaultKeys(provider, dataKey);
    const second = await deriveVaultKeys(provider, dataKey);
    expect(toBase64(second.database)).toBe(toBase64(first.database));
  });

  it('gives every file its own key, so no nonce is ever reused across files', async () => {
    const { dataKey } = await newVault();
    const { files } = await deriveVaultKeys(provider, dataKey);

    const a = await deriveFileKey(provider, files, 'file-1');
    const b = await deriveFileKey(provider, files, 'file-2');
    const aAgain = await deriveFileKey(provider, files, 'file-1');

    expect(toBase64(a)).not.toBe(toBase64(b));
    expect(toBase64(aAgain)).toBe(toBase64(a));
  });

  it('formats a SQLCipher raw key', async () => {
    const { dataKey } = await newVault();
    const { database } = await deriveVaultKeys(provider, dataKey);
    expect(toSqlCipherKey(database)).toMatch(/^x'[0-9a-f]{64}'$/);
  });

  it('wipes key material on request', () => {
    const key = provider.randomBytes(32);
    wipe(key);
    expect(key.every((byte) => byte === 0)).toBe(true);
  });
});

describe('end to end', () => {
  it('encrypts and recovers data across a simulated reinstall', async () => {
    // Day one: create a vault, encrypt something with the oplog key.
    const created = await newVault(DECOY);
    const keys = await deriveVaultKeys(provider, created.dataKey);
    const segment = utf8ToBytes(JSON.stringify({ expense: 'coffee', amount: 4500 }));
    const sealed = await provider.encrypt(keys.oplog, segment, 'vaultp/oplog/segment-1');

    // Everything is lost except the keyfile in cloud storage and the passphrase.
    const backup = serializeKeyfile(created.keyfile);

    const restored = await unlockVault(provider, parseKeyfile(backup), PASSPHRASE);
    const restoredKeys = await deriveVaultKeys(provider, restored.dataKey);
    const recovered = await provider.decrypt(
      restoredKeys.oplog,
      sealed,
      'vaultp/oplog/segment-1',
    );

    expect(JSON.parse(bytesToUtf8(recovered))).toEqual({ expense: 'coffee', amount: 4500 });
  });

  it('cannot read real data with the decoy key', async () => {
    const created = await newVault(DECOY);
    const realKeys = await deriveVaultKeys(provider, created.dataKey);
    const sealed = await provider.encrypt(realKeys.oplog, utf8ToBytes('private'), 'aad');

    const decoy = await unlockVault(provider, created.keyfile, DECOY);
    const decoyKeys = await deriveVaultKeys(provider, decoy.dataKey);

    await expect(provider.decrypt(decoyKeys.oplog, sealed, 'aad')).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('adopting an existing key', () => {
  it('wraps a key that already exists instead of making a new one', async () => {
    // The migration case: a vault created before passphrases existed, whose key
    // lived only in the device keystore. Giving it a passphrase must not change
    // the key, or every row already written becomes unreadable.
    const existing = provider.randomBytes(32);

    const created = await createVault(provider, {
      passphrase: PASSPHRASE,
      dataKey: existing,
      kdf: FAST_KDF,
    });

    expect(toBase64(created.dataKey)).toBe(toBase64(existing));

    const opened = await unlockVault(provider, created.keyfile, PASSPHRASE);
    expect(toBase64(opened.dataKey)).toBe(toBase64(existing));
  });

  it('still gives the decoy its own independent key', async () => {
    const existing = provider.randomBytes(32);
    const created = await createVault(provider, {
      passphrase: PASSPHRASE,
      decoyPassphrase: DECOY,
      dataKey: existing,
      kdf: FAST_KDF,
    });

    expect(toBase64(created.decoyDataKey)).not.toBe(toBase64(existing));
  });

  it('rejects a key of the wrong length', async () => {
    await expect(
      createVault(provider, {
        passphrase: PASSPHRASE,
        dataKey: provider.randomBytes(16),
        kdf: FAST_KDF,
      }),
    ).rejects.toThrow(/exactly 32 bytes/);
  });
});
