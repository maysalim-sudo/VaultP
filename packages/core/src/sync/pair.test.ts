/**
 * Pairing: a phone syncing straight to a computer.
 *
 * The wire here is a function call, which is the point of keeping the protocol
 * transport-free — but it is the real client and the real server either side
 * of it, so what is tested is exactly what crosses the Wi-Fi.
 */

import { describe, expect, it } from 'vitest';

import { toBase64, utf8ToBytes } from '../crypto/base64.js';
import { webCryptoProvider as provider } from '../crypto/webcrypto.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { MemoryBackend, ObjectNotFoundError } from './backend.js';
import { SyncEngine } from './engine.js';
import {
  PAIRING_SECRET_LENGTH,
  PairBackend,
  PairingAuthError,
  PairingFormatError,
  createPairServer,
  encodePairing,
  parsePairing,
} from './pair.js';
import { KEYFILE_KEY } from './segments.js';

const OPLOG_KEY = provider.randomBytes(32);

/** A computer's hub and a phone's view of it, joined by a wire that can be tapped. */
function pair(options: { clientSecret?: Uint8Array } = {}) {
  const secret = provider.randomBytes(PAIRING_SECRET_LENGTH);
  const hub = new MemoryBackend();
  let changes = 0;
  const server = createPairServer({ backend: hub, secret, name: 'Study PC', onChange: () => (changes += 1) });

  const wire = { requests: [] as string[], tamper: (reply: string) => reply };
  const client = new PairBackend({
    secret: options.clientSecret ?? secret,
    randomBytes: (n) => provider.randomBytes(n),
    send: async (request) => {
      wire.requests.push(request);
      const reply = await server(request);
      if (reply === null) throw new Error('refused');
      return wire.tamper(reply);
    },
  });

  return { hub, server, client, wire, secret, changes: () => changes };
}

describe('the pairing code', () => {
  it('survives the trip through a QR code', () => {
    const pairing = {
      addresses: ['192.168.1.20:47821', '10.0.0.5:47821'],
      secret: toBase64(provider.randomBytes(PAIRING_SECRET_LENGTH)),
      name: "Salim's PC",
    };
    expect(parsePairing(encodePairing(pairing))).toEqual(pairing);
  });

  it('refuses anything that is not one', () => {
    expect(() => parsePairing('https://example.com')).toThrow(PairingFormatError);
    expect(() => parsePairing('vaultp://pair?v=1&a=192.168.1.2:1&s=short&n=x')).toThrow(PairingFormatError);
    expect(() => parsePairing('vaultp://pair?v=9&a=192.168.1.2:1&s=x&n=x')).toThrow(/different version/);
  });
});

describe('the paired store', () => {
  it('does the four operations, bytes intact', async () => {
    const { client, hub } = pair();
    const bytes = new Uint8Array([0, 255, 1, 254, 128]);

    await client.put('segments/dev_phone/00000001.seg', bytes);
    expect(hub.raw('segments/dev_phone/00000001.seg')).toEqual(bytes);
    expect(await client.get('segments/dev_phone/00000001.seg')).toEqual(bytes);
    expect((await client.list('segments/')).map((o) => o.key)).toEqual(['segments/dev_phone/00000001.seg']);

    await client.delete('segments/dev_phone/00000001.seg');
    expect(await client.list('')).toEqual([]);
  });

  it('reports a missing object the way every backend does', async () => {
    const { client } = pair();
    await expect(client.get('files/nope.enc')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('says who it is, and whether there is a vault to join', async () => {
    const { client, hub } = pair();
    expect(await client.hello()).toEqual({ name: 'Study PC', hasVault: false });

    await hub.put(KEYFILE_KEY, utf8ToBytes('{}'));
    expect((await client.hello()).hasVault).toBe(true);
  });

  it('tells the computer when something arrived, and only then', async () => {
    const { client, changes } = pair();
    await client.list('');
    expect(changes()).toBe(0);
    await client.put('files/a.enc', new Uint8Array([1]));
    expect(changes()).toBe(1);
  });

  it('will not write outside the store', async () => {
    const { client, hub } = pair();
    await expect(client.put('../keyfile.json', new Uint8Array([1]))).rejects.toThrow();
    await expect(client.put('/etc/passwd', new Uint8Array([1]))).rejects.toThrow();
    expect(hub.keys()).toEqual([]);
  });
});

describe('who may speak to it', () => {
  it('refuses a device that never saw the QR code', async () => {
    const { client, hub } = pair({ clientSecret: provider.randomBytes(PAIRING_SECRET_LENGTH) });
    await expect(client.put('files/a.enc', new Uint8Array([1]))).rejects.toThrow('refused');
    expect(hub.keys()).toEqual([]);
  });

  it('refuses a captured request sent a second time', async () => {
    const { client, server, wire } = pair();
    await client.put('files/a.enc', new Uint8Array([1]));
    expect(await server(wire.requests[0]!)).toBeNull();
  });

  it('refuses a request altered on the way', async () => {
    const { client, server, wire, hub } = pair();
    await client.put('files/a.enc', new Uint8Array([1]));
    const altered = wire.requests[0]!.replace('files/a.enc', 'files/b.enc').replace(/"n":"[0-9a-f]+"/, '"n":"0123456789abcdef0123"');
    expect(await server(altered)).toBeNull();
    expect(hub.keys()).toEqual(['files/a.enc']);
  });

  it('notices a reply that did not come from the computer', async () => {
    const { client, wire } = pair();
    await client.put('files/a.enc', new Uint8Array([7]));

    wire.tamper = (reply) => reply.replace(/"p":"/, '"p":" ');
    await expect(client.get('files/a.enc')).rejects.toBeInstanceOf(PairingAuthError);
  });
});

describe('syncing through it', () => {
  it('carries a phone and a computer to the same vault', async () => {
    const { client, hub } = pair();

    const phoneStore = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
    const desktopStore = VaultStore.open({ db: openTestDatabase(), device: 'dev_desktop' });
    // The phone reaches the hub over the wire; the computer reads it directly.
    const phone = new SyncEngine({ store: phoneStore, backend: client, provider, oplogKey: OPLOG_KEY });
    const desktop = new SyncEngine({ store: desktopStore, backend: hub, provider, oplogKey: OPLOG_KEY });

    phoneStore.commit('note', 'n1', { body: 'From the phone' });
    desktopStore.commit('note', 'n2', { body: 'From the computer' });

    await phone.sync();
    await desktop.sync();
    await phone.sync();

    for (const store of [phoneStore, desktopStore]) {
      expect(store.read('note', 'n1')?.body).toBe('From the phone');
      expect(store.read('note', 'n2')?.body).toBe('From the computer');
    }
  });
});
