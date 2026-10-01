/**
 * The pairing server, over a real socket.
 *
 * Core's tests cover the protocol with a function call for a wire. This covers
 * what only exists here: the HTTP server around it, the hub folder on disk, and
 * the pairing surviving a restart.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PairBackend, PairingAuthError, fromBase64, webCryptoProvider } from '@vaultp/core';

import {
  ensurePairing,
  forgetPairing,
  hubDirectory,
  hubHasVault,
  isPaired,
  pairingPort,
  pairingStatus,
  startPairing,
} from './pairing.js';

let root: string;
let changes: number;

async function client(secretOverride?: Uint8Array): Promise<PairBackend> {
  const { secret } = JSON.parse(await readFile(join(root, 'pairing.json'), 'utf8')) as { secret: string };
  const url = `http://127.0.0.1:${pairingPort()}/v1`;
  return new PairBackend({
    secret: secretOverride ?? fromBase64(secret),
    randomBytes: (n) => webCryptoProvider.randomBytes(n),
    send: async (body) => {
      const response = await fetch(url, { method: 'POST', body });
      if (!response.ok) throw new PairingAuthError();
      return response.text();
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vaultp-pair-'));
  changes = 0;
  await ensurePairing(root, () => (changes += 1));
});

afterEach(async () => {
  await forgetPairing(root);
  await rm(root, { recursive: true, force: true });
});

describe('the pairing server', () => {
  it('stores what the phone sends in the hub folder, and gives it back', async () => {
    const phone = await client();
    const bytes = new Uint8Array([9, 8, 7, 0, 255]);

    await phone.put('segments/dev_phone/00000001.seg', bytes);

    expect(new Uint8Array(await readFile(join(hubDirectory(root), 'segments', 'dev_phone', '00000001.seg')))).toEqual(bytes);
    expect(await phone.get('segments/dev_phone/00000001.seg')).toEqual(bytes);
    expect((await phone.list('segments/')).map((o) => o.key)).toEqual(['segments/dev_phone/00000001.seg']);
    expect(changes).toBe(1);
  });

  it('refuses a device without the secret, and stores nothing', async () => {
    const stranger = await client(webCryptoProvider.randomBytes(32));
    await expect(stranger.put('files/a.enc', new Uint8Array([1]))).rejects.toBeInstanceOf(PairingAuthError);
    expect(changes).toBe(0);
  });

  it('answers nothing but its one route', async () => {
    const response = await fetch(`http://127.0.0.1:${pairingPort()}/`);
    expect(response.status).toBe(404);
  });

  it('notices when the phone has left a vault to join', async () => {
    expect(await hubHasVault(root)).toBe(false);
    await (await client()).put('keyfile.json', new TextEncoder().encode('{}'));
    expect(await hubHasVault(root)).toBe(true);
    expect((await pairingStatus(root)).hubHasVault).toBe(true);
  });

  it('stops answering once unpaired, and forgets the secret', async () => {
    const phone = await client();
    const port = pairingPort();
    await forgetPairing(root);

    expect(isPaired()).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/v1`, { method: 'POST', body: '{}' })).rejects.toThrow();
    await expect(readFile(join(root, 'pairing.json'))).rejects.toThrow();
    // Re-pair, so afterEach has something to tear down.
    await ensurePairing(root, () => undefined);
    await expect(phone.list('')).rejects.toBeTruthy();
  });

  it('keeps the same pairing across a restart', async () => {
    const before = await readFile(join(root, 'pairing.json'), 'utf8');
    // What a relaunch does: no pairing is created, the saved one is served.
    await startPairing(root, () => undefined);
    expect(await readFile(join(root, 'pairing.json'), 'utf8')).toBe(before);
    expect(isPaired()).toBe(true);
  });
});
