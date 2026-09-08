/**
 * The Drive backend, against a stand-in for Drive.
 *
 * The fake below is deliberately picky about the things that actually differ
 * from a filesystem: Drive has no paths, lets two files share a name, returns
 * results in no useful order, and pages. A backend that works against a folder
 * can fail on every one of those, which is what these pin down.
 *
 * The last group is the point of the whole exercise: whatever Drive ends up
 * holding must be unreadable.
 */

import { describe, expect, it } from 'vitest';

import { ObjectNotFoundError } from './backend.js';
import { DriveApiError, DriveAuthError, DriveBackend, fetchHttp } from './drive.js';
import { SyncEngine } from './engine.js';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { webCryptoProvider as provider } from '../crypto/webcrypto.js';
import { parseAmount } from '../money/money.js';
import { bytesToUtf8 } from '../crypto/base64.js';

interface StoredFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  appProperties: Record<string, string>;
  data: Uint8Array;
  trashed: boolean;
}

/** A Drive that behaves like the real one in the ways that matter. */
class FakeDrive {
  readonly files = new Map<string, StoredFile>();
  readonly requests: string[] = [];
  /** Statuses to return before behaving, for exercising retries. */
  readonly failures: number[] = [];
  private next = 0;
  /** Drive pages; a backend that ignores nextPageToken loses objects. */
  pageSize = 1000;

  fetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const href = typeof url === 'string' ? url : url.toString();
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${href.split('?')[0]}`);

    if (!new Headers(init.headers).get('Authorization')?.startsWith('Bearer ')) {
      return json({ error: { message: 'no token' } }, 401);
    }

    const failure = this.failures.shift();
    if (failure !== undefined) return json({ error: { message: 'slow down' } }, failure);

    const parsed = new URL(href);
    const query = parsed.searchParams.get('q') ?? '';

    if (parsed.pathname.endsWith('/upload/drive/v3/files') && method === 'POST') {
      return this.create(init);
    }
    if (parsed.pathname.includes('/upload/drive/v3/files/') && method === 'PATCH') {
      const id = parsed.pathname.split('/').pop()!;
      const file = this.files.get(id);
      if (!file) return json({ error: { message: 'no such file' } }, 404);
      file.data = new Uint8Array(init.body as Uint8Array);
      return json({ id });
    }
    if (parsed.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body as string) as { name: string; mimeType: string };
      const id = `id_${(this.next += 1)}`;
      this.files.set(id, {
        id, name: body.name, parents: [], mimeType: body.mimeType,
        appProperties: {}, data: new Uint8Array(), trashed: false,
      });
      return json({ id });
    }
    if (parsed.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') {
      this.files.delete(parsed.pathname.split('/').pop()!);
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname.startsWith('/drive/v3/files/') && parsed.searchParams.has('alt')) {
      const file = this.files.get(parsed.pathname.split('/').pop()!);
      if (!file) return json({ error: { message: 'gone' } }, 404);
      return new Response(file.data, { status: 200 });
    }
    if (parsed.pathname === '/drive/v3/files') return this.list(query, parsed);

    return json({ error: { message: `unhandled ${href}` } }, 400);
  };

  private create(init: RequestInit): Response {
    const body = new TextDecoder().decode(init.body as Uint8Array);
    const metaStart = body.indexOf('{');
    const metaEnd = body.indexOf('}\r\n--');
    const metadata = JSON.parse(body.slice(metaStart, metaEnd + 1)) as {
      name: string; parents: string[]; appProperties: Record<string, string>;
    };

    // The media part, byte-exact: taking it from the decoded string would
    // corrupt anything that is not valid UTF-8, which ciphertext is not.
    const raw = new Uint8Array(init.body as Uint8Array);
    const marker = new TextEncoder().encode('application/octet-stream\r\n\r\n');
    const start = indexOfBytes(raw, marker) + marker.length;
    const end = raw.length - new TextEncoder().encode(`\r\n--`).length - 0;
    const tailBoundary = indexOfBytes(raw.subarray(start), new TextEncoder().encode('\r\n--'));

    const id = `id_${(this.next += 1)}`;
    this.files.set(id, {
      id,
      name: metadata.name,
      parents: metadata.parents,
      mimeType: 'application/octet-stream',
      appProperties: metadata.appProperties,
      data: raw.slice(start, tailBoundary >= 0 ? start + tailBoundary : end),
      trashed: false,
    });
    return json({ id });
  }

  private list(query: string, parsed: URL): Response {
    let matches = [...this.files.values()].filter((file) => !file.trashed);

    const parent = /'([^']+)' in parents/.exec(query);
    if (parent) matches = matches.filter((file) => file.parents.includes(parent[1]!));

    const named = /name = '([^']+)'/.exec(query);
    if (named) matches = matches.filter((file) => file.name === named[1]);

    const mime = /mimeType = '([^']+)'/.exec(query);
    if (mime) matches = matches.filter((file) => file.mimeType === mime[1]);

    const property = /appProperties has \{ key='([^']+)' and value='(.*?)' \}/.exec(query);
    if (property) {
      const value = property[2]!.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      matches = matches.filter((file) => file.appProperties[property[1]!] === value);
    }

    // Reverse order on purpose: nothing may depend on Drive's ordering.
    matches.reverse();

    const token = parsed.searchParams.get('pageToken');
    const offset = token ? Number(token) : 0;
    const page = matches.slice(offset, offset + this.pageSize);
    const nextOffset = offset + this.pageSize;

    return json({
      files: page.map((file) => ({
        id: file.id,
        name: file.name,
        size: String(file.data.length),
        modifiedTime: '2026-09-08T00:00:00.000Z',
        appProperties: file.appProperties,
      })),
      ...(nextOffset < matches.length ? { nextPageToken: String(nextOffset) } : {}),
    });
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function newBackend(drive = new FakeDrive(), token = 'token') {
  const backend = new DriveBackend({
    auth: { accessToken: () => Promise.resolve(token) },
    fetch: drive.fetch,
    wait: () => Promise.resolve(),
  });
  return { drive, backend };
}

const BYTES = new Uint8Array([0, 1, 2, 250, 251, 255, 13, 10]);

describe('the Drive backend', () => {
  it('stores and returns bytes unchanged', async () => {
    const { backend } = newBackend();
    await backend.put('oplog/dev_a/000000.seg.enc', BYTES);

    expect(Array.from(await backend.get('oplog/dev_a/000000.seg.enc'))).toEqual(
      Array.from(BYTES),
    );
  });

  it('survives bytes that are not valid text', async () => {
    const { backend } = newBackend();
    // Ciphertext is not UTF-8, and a multipart body assembled as a string
    // mangles it. This is the case that would corrupt every segment.
    const awkward = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) awkward[i] = i;

    await backend.put('files/f1.enc', awkward);
    expect(Array.from(await backend.get('files/f1.enc'))).toEqual(Array.from(awkward));
  });

  it('creates the folder once, however many objects are written', async () => {
    const { drive, backend } = newBackend();
    await backend.put('a', BYTES);
    await backend.put('b', BYTES);
    await backend.put('c', BYTES);

    const folders = [...drive.files.values()].filter(
      (file) => file.mimeType === 'application/vnd.google-apps.folder',
    );
    // A second folder of the same name is how a vault silently splits in two.
    expect(folders).toHaveLength(1);
  });

  it('lists by key prefix, sorted, not by whatever Drive returns', async () => {
    const { backend } = newBackend();
    await backend.put('oplog/dev_b/000001.seg.enc', BYTES);
    await backend.put('oplog/dev_a/000000.seg.enc', BYTES);
    await backend.put('files/f1.enc', BYTES);

    const listed = await backend.list('oplog/');

    expect(listed.map((object) => object.key)).toEqual([
      'oplog/dev_a/000000.seg.enc',
      'oplog/dev_b/000001.seg.enc',
    ]);
    expect(listed[0]?.size).toBe(BYTES.length);
  });

  it('pages through a folder holding more than one page', async () => {
    const { drive, backend } = newBackend();
    drive.pageSize = 3;
    for (let i = 0; i < 10; i += 1) {
      await backend.put(`oplog/dev_a/${String(i).padStart(6, '0')}.seg.enc`, BYTES);
    }

    // Ignoring nextPageToken would quietly return three of ten, and the engine
    // would conclude the other seven segments do not exist.
    expect(await backend.list('oplog/')).toHaveLength(10);
  });

  it('replaces an object in place rather than deleting and recreating it', async () => {
    const { drive, backend } = newBackend();
    await backend.put('keyfile.json', BYTES);
    const before = [...drive.files.keys()];

    await backend.put('keyfile.json', new Uint8Array([9, 9, 9]));

    expect([...drive.files.keys()]).toEqual(before);
    expect(Array.from(await backend.get('keyfile.json'))).toEqual([9, 9, 9]);
  });

  it('finds an object by key even when names collide', async () => {
    const { drive, backend } = newBackend();
    await backend.put('oplog/dev_a/000000.seg.enc', BYTES);

    // Drive permits duplicate names. Something else called the same thing must
    // not be mistaken for our object.
    drive.files.set('decoy', {
      id: 'decoy',
      name: 'oplog_dev_a_000000.seg.enc',
      parents: [...drive.files.values()][0]!.parents,
      mimeType: 'application/octet-stream',
      appProperties: {},
      data: new Uint8Array([7, 7, 7]),
      trashed: false,
    });

    expect(Array.from(await backend.get('oplog/dev_a/000000.seg.enc'))).toEqual(
      Array.from(BYTES),
    );
  });

  it('reports a missing object as missing', async () => {
    const { backend } = newBackend();
    await expect(backend.get('nothing/here')).rejects.toThrow(ObjectNotFoundError);
  });

  it('deleting something absent is not an error', async () => {
    const { backend } = newBackend();
    await expect(backend.delete('nothing/here')).resolves.toBeUndefined();
  });

  it('deletes what it wrote', async () => {
    const { backend } = newBackend();
    await backend.put('files/f1.enc', BYTES);
    await backend.delete('files/f1.enc');

    await expect(backend.get('files/f1.enc')).rejects.toThrow(ObjectNotFoundError);
    expect(await backend.list('files/')).toEqual([]);
  });

  it('ignores files in the folder that this app did not write', async () => {
    const { drive, backend } = newBackend();
    await backend.put('files/f1.enc', BYTES);
    const folder = [...drive.files.values()][0]!;

    // Somebody dropped a holiday photo into the backup folder.
    drive.files.set('photo', {
      id: 'photo', name: 'beach.jpg', parents: [folder.id],
      mimeType: 'image/jpeg', appProperties: {}, data: new Uint8Array([1]),
      trashed: false,
    });

    expect((await backend.list('')).map((object) => object.key)).toEqual(['files/f1.enc']);
  });
});

describe('the transport seam', () => {
  it('routes every request through a supplied transport, bytes intact', async () => {
    const drive = new FakeDrive();
    const seen: Array<{ url: string; method: string; body?: Uint8Array | string }> = [];

    // What the phone supplies, because React Native's fetch cannot send bytes.
    // The bytes must reach it as bytes: a transport handed a string would have
    // to guess an encoding, and ciphertext has none.
    const backend = new DriveBackend({
      auth: { accessToken: () => Promise.resolve('token') },
      wait: () => Promise.resolve(),
      http: {
        async send(request) {
          seen.push({
            url: request.url,
            method: request.method,
            ...(request.body === undefined ? {} : { body: request.body }),
          });
          return fetchHttp(drive.fetch).send(request);
        },
      },
    });

    await backend.put('files/f1.enc', BYTES);
    expect(Array.from(await backend.get('files/f1.enc'))).toEqual(Array.from(BYTES));

    // The folder is created with a JSON string body; only the media upload
    // carries bytes, and that is the one that must arrive as bytes.
    const upload = seen.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(upload?.body).toBeInstanceOf(Uint8Array);

    const folder = seen.find(
      (request) => request.method === 'POST' && !request.url.includes('/upload/'),
    );
    expect(typeof folder?.body).toBe('string');
  });
});

describe('when Drive says no', () => {
  it('asks for a new sign-in rather than retrying a rejected token', async () => {
    const drive = new FakeDrive();
    let invalidated = false;
    const backend = new DriveBackend({
      auth: {
        accessToken: () => Promise.resolve(''),
        invalidate: () => { invalidated = true; },
      },
      fetch: drive.fetch,
      wait: () => Promise.resolve(),
    });

    await expect(backend.list('')).rejects.toThrow(DriveAuthError);
    expect(invalidated).toBe(true);
  });

  it('retries a rate limit and then succeeds', async () => {
    const drive = new FakeDrive();
    drive.failures.push(429, 503);
    const { backend } = newBackend(drive);

    // A sync that abandons the push on one 429 leaves the vault half-uploaded.
    await expect(backend.put('files/f1.enc', BYTES)).resolves.toBeUndefined();
  });

  it('gives up on a rate limit that never clears, saying which', async () => {
    const drive = new FakeDrive();
    drive.failures.push(429, 429, 429, 429, 429, 429);
    const { backend } = newBackend(drive);

    await expect(backend.list('')).rejects.toThrow(DriveApiError);
  });
});

describe('what Google ends up holding', () => {
  it('is ciphertext, and the merge still works through it', async () => {
    const drive = new FakeDrive();
    const oplogKey = provider.randomBytes(32);

    const phone = VaultStore.open({ db: openTestDatabase(), device: 'dev_phone' });
    const desktop = VaultStore.open({ db: openTestDatabase(), device: 'dev_desktop' });

    const engineFor = (store: VaultStore) =>
      new SyncEngine({
        store,
        backend: new DriveBackend({
          auth: { accessToken: () => Promise.resolve('token') },
          fetch: drive.fetch,
          wait: () => Promise.resolve(),
        }),
        provider,
        oplogKey,
      });

    phone.commit('expense', 'e1', {
      occurred_on: '2026-09-07',
      amount_minor: parseAmount('123.750', 'TND').amountMinor,
      currency: 'TND',
      merchant: 'Carrefour',
    });

    await engineFor(phone).sync();
    await engineFor(desktop).sync();

    expect(desktop.read('expense', 'e1')?.merchant).toBe('Carrefour');

    // Nothing Google stores says what was bought or for how much.
    for (const file of drive.files.values()) {
      if (file.data.length === 0) continue;
      const text = bytesToUtf8(file.data);
      expect(text).not.toContain('Carrefour');
      expect(text).not.toContain('123');
    }
  });
});
