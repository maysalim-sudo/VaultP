/**
 * Google Drive as a storage backend.
 *
 * The same four operations as a folder or a USB stick. Everything written here
 * is already encrypted, so Google stores ciphertext and object names and can
 * read neither the amounts nor the documents.
 *
 * WHY FLAT, AND NOT A FOLDER TREE. Drive has no paths — a "folder" is a file
 * that other files name as a parent — so a key like `oplog/<device>/000001.enc`
 * would mean creating and looking up two folders per write. That reintroduces
 * exactly what the rest of the sync design removes: two devices syncing at once
 * would race to create the same folder and could each end up with a different
 * one of the same name, silently splitting the vault in two. So every object is
 * one file in one folder, and its key lives in `appProperties`, which is private
 * to this application.
 *
 * SCOPE. `drive.file` — this app can see and touch only what it created. It
 * cannot read the rest of someone's Drive, and no amount of wrong code here can
 * change that, because the token is not granted the access in the first place.
 *
 * The folder is deliberately visible rather than hidden in `appDataFolder`: this
 * is somebody's backup, and a backup you cannot see is one you cannot check is
 * there.
 */

import { ObjectNotFoundError, type RemoteObject, type StorageBackend } from './backend.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const OBJECT_MIME = 'application/octet-stream';

/** The key is carried here rather than in the name, which Drive does not keep unique. */
const KEY_PROPERTY = 'vaultpKey';

export const DEFAULT_DRIVE_FOLDER = 'VaultP';

/**
 * One HTTP exchange, binary-safe in both directions.
 *
 * Below `fetch` on purpose. React Native's `fetch` cannot send a typed array as
 * a body — it accepts strings, form data and blobs, and blobs cannot be built
 * from bytes there — so the phone has to route uploads through a file instead.
 * Putting the seam here rather than swapping the whole backend means the token
 * handling and the retries below are the same code on both platforms.
 */
export interface DriveHttp {
  send(request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array | string;
  }): Promise<DriveResponse>;
}

export interface DriveResponse {
  readonly status: number;
  /** From `Retry-After`, in seconds, when Drive sent one. */
  readonly retryAfterSeconds: number | null;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

/** The default: ordinary `fetch`, which is binary-safe on Node and Electron. */
export function fetchHttp(impl: typeof globalThis.fetch): DriveHttp {
  return {
    async send(request) {
      const response = await impl(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(request.body === undefined
          ? {}
          : { body: typeof request.body === 'string' ? request.body : asBody(request.body) }),
      });

      const after = Number(response.headers.get('retry-after'));
      return {
        status: response.status,
        retryAfterSeconds: Number.isFinite(after) && after > 0 ? after : null,
        text: () => response.text(),
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

/**
 * Supplies an access token, refreshing it when needed.
 *
 * Implemented per platform, because the two do OAuth differently — a loopback
 * redirect on the desktop, an app redirect on the phone — and neither belongs in
 * code that decides what is true.
 */
export interface DriveAuth {
  accessToken(): Promise<string>;
  /** Called when Drive rejects the token, so the caller can force a refresh. */
  invalidate?(): void;
}

/** Drive refused the credentials. Distinct, because the fix is to sign in again. */
export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** Drive failed for a reason that is not the caller's fault and may not persist. */
export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

export interface DriveBackendOptions {
  readonly auth: DriveAuth;
  /** Folder created in the user's Drive. One vault per folder. */
  readonly folderName?: string;
  /** Injectable so the tests can drive this without a network. */
  readonly fetch?: typeof globalThis.fetch;
  /** Overrides `fetch` entirely, for a platform that cannot send bytes through it. */
  readonly http?: DriveHttp;
  /** Attempts for a request Drive says to retry. */
  readonly maxAttempts?: number;
  /** Injectable so retry tests do not actually sleep. */
  readonly wait?: (ms: number) => Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class DriveBackend implements StorageBackend {
  private readonly auth: DriveAuth;
  private readonly folderName: string;
  private readonly http: DriveHttp;
  private readonly maxAttempts: number;
  private readonly wait: (ms: number) => Promise<void>;

  /** Resolved once. A second lookup would be a second chance to create a duplicate. */
  private folderId: Promise<string> | undefined;

  constructor(options: DriveBackendOptions) {
    this.auth = options.auth;
    this.folderName = options.folderName ?? DEFAULT_DRIVE_FOLDER;
    this.http =
      options.http ?? fetchHttp(options.fetch ?? globalThis.fetch.bind(globalThis));
    this.maxAttempts = options.maxAttempts ?? 4;
    this.wait = options.wait ?? sleep;
  }

  // ------------------------------------------------------------------ http

  private async request(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: Uint8Array | string;
    } = {},
  ): Promise<DriveResponse> {
    for (let attempt = 1; ; attempt += 1) {
      const token = await this.auth.accessToken();

      const response = await this.http.send({
        url,
        method: init.method ?? 'GET',
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
      if (response.status >= 200 && response.status < 300) return response;

      if (response.status === 401 || response.status === 403) {
        // Told once that the token is no good; a second identical attempt would
        // only ask again with the same credentials.
        this.auth.invalidate?.();
        throw new DriveAuthError(
          response.status === 401
            ? 'Google rejected the sign-in. Connect the account again.'
            : 'Google refused the request. The account may not have granted access to this app.',
        );
      }

      // 429 and 5xx are Drive asking for patience rather than a different
      // request, and a sync that gives up on one leaves the vault half-pushed.
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxAttempts) {
        throw new DriveApiError(response.status, await describe(response));
      }

      await this.wait(
        response.retryAfterSeconds !== null
          ? response.retryAfterSeconds * 1000
          : 2 ** attempt * 250,
      );
    }
  }

  private async json<T>(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<T> {
    return JSON.parse(await (await this.request(url, init)).text()) as T;
  }

  // ---------------------------------------------------------------- folder

  /**
   * The vault's folder, created on first use.
   *
   * With `drive.file` this search only ever sees folders this app made, so a
   * folder the user happens to have called VaultP is not adopted by accident.
   */
  private resolveFolder(): Promise<string> {
    this.folderId ??= (async () => {
      const query = [
        `name = '${escapeQuery(this.folderName)}'`,
        `mimeType = '${FOLDER_MIME}'`,
        'trashed = false',
      ].join(' and ');

      const found = await this.json<{ files: DriveFile[] }>(
        `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=10`,
      );
      const existing = found.files[0];
      if (existing) return existing.id;

      const created = await this.json<DriveFile>(`${DRIVE_FILES}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.folderName, mimeType: FOLDER_MIME }),
      });
      return created.id;
    })();

    return this.folderId;
  }

  // -------------------------------------------------------------- contract

  async list(prefix: string): Promise<RemoteObject[]> {
    const folder = await this.resolveFolder();
    const found: RemoteObject[] = [];
    let pageToken: string | undefined;

    do {
      const query = `'${folder}' in parents and trashed = false`;
      const url =
        `${DRIVE_FILES}?q=${encodeURIComponent(query)}` +
        `&fields=${encodeURIComponent('nextPageToken,files(id,name,size,modifiedTime,appProperties)')}` +
        `&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;

      const page = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(url);

      for (const file of page.files) {
        const key = file.appProperties?.[KEY_PROPERTY];
        // Anything without our key was not written by this app's sync — or was
        // written by a newer one that means something else by it. Skipped rather
        // than guessed at.
        if (!key || !key.startsWith(prefix)) continue;

        found.push({
          key,
          size: Number(file.size ?? 0),
          ...(file.modifiedTime ? { modifiedAt: file.modifiedTime } : {}),
        });
      }

      pageToken = page.nextPageToken;
    } while (pageToken);

    // Sorted here because the engine relies on segment keys arriving in order,
    // and Drive gives no ordering worth depending on.
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async get(key: string): Promise<Uint8Array> {
    const file = await this.find(key);
    if (!file) throw new ObjectNotFoundError(key);

    return (await this.request(`${DRIVE_FILES}/${file.id}?alt=media`)).bytes();
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const existing = await this.find(key);

    if (existing) {
      // Replace the bytes in place. A delete-then-create would leave a window in
      // which another device listing the folder finds nothing where an object was.
      await this.request(`${DRIVE_UPLOAD}/${existing.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': OBJECT_MIME },
        body: data,
      });
      return;
    }

    const folder = await this.resolveFolder();
    const metadata = {
      name: nameFor(key),
      parents: [folder],
      appProperties: { [KEY_PROPERTY]: key },
    };

    const boundary = `vaultp-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    await this.request(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart(boundary, metadata, data),
    });
  }

  async delete(key: string): Promise<void> {
    const file = await this.find(key);
    // Deleting what is not there is not an error; a caller removing a blob it
    // never uploaded is an ordinary outcome of two devices tidying up.
    if (!file) return;

    await this.request(`${DRIVE_FILES}/${file.id}`, { method: 'DELETE' });
  }

  private async find(key: string): Promise<DriveFile | undefined> {
    const folder = await this.resolveFolder();
    const query = [
      `'${folder}' in parents`,
      `appProperties has { key='${KEY_PROPERTY}' and value='${escapeQuery(key)}' }`,
      'trashed = false',
    ].join(' and ');

    const found = await this.json<{ files: DriveFile[] }>(
      `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,size,modifiedTime,appProperties)')}&pageSize=2`,
    );
    return found.files[0];
  }
}

/**
 * A readable name for the Drive UI.
 *
 * Cosmetic only — nothing reads it back. The key in `appProperties` is what
 * identifies an object, because Drive lets two files share a name and would
 * otherwise make "which one is `000001.seg.enc`?" ambiguous.
 */
function nameFor(key: string): string {
  return key.replace(/\//g, '_');
}

/** Drive's query language is single-quoted, with backslash escapes. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Bytes in a form `fetch` will accept everywhere.
 *
 * A plain `ArrayBuffer` rather than the view it came in as: the typed-array
 * types differ enough between platforms and TypeScript versions to be a
 * recurring argument, and a buffer is accepted by all of them.
 */
function asBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function multipart(
  boundary: string,
  metadata: unknown,
  data: Uint8Array,
): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${OBJECT_MIME}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return body;
}

async function describe(response: DriveResponse): Promise<string> {
  try {
    const body = JSON.parse(await response.text()) as { error?: { message?: string } };
    if (body.error?.message) return `Google Drive: ${body.error.message}`;
  } catch {
    // Not JSON; the status is all there is to report.
  }
  return `Google Drive returned ${response.status}.`;
}
