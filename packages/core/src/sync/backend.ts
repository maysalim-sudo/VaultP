/**
 * Cloud storage, reduced to four operations.
 *
 * The sync design deliberately asks almost nothing of the provider: no queries, no
 * locking, no server-side logic, no atomic compare-and-swap. Anything that can
 * store and list opaque blobs will do — Google Drive, a Syncthing folder, a USB
 * stick. That keeps the Drive OAuth question from being able to block the project,
 * and means the vault is never hostage to one company's API.
 *
 * Everything written through this interface is already encrypted. A backend, and
 * whoever runs it, sees only ciphertext and object names.
 */

export interface RemoteObject {
  readonly key: string;
  readonly size: number;
  /** Provider timestamp when available. Never used for ordering — HLCs do that. */
  readonly modifiedAt?: string;
}

export interface StorageBackend {
  /** Keys beginning with `prefix`, sorted ascending. */
  list(prefix: string): Promise<RemoteObject[]>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No object at "${key}".`);
    this.name = 'ObjectNotFoundError';
  }
}

/**
 * In-memory backend for tests and for exercising sync without a network.
 *
 * Also the reference for what a real backend must do: return keys sorted, throw
 * ObjectNotFoundError for a missing key, and never reorder or mutate bytes.
 */
export class MemoryBackend implements StorageBackend {
  private readonly objects = new Map<string, Uint8Array>();
  /** Counts calls, so tests can assert sync does not re-download what it has. */
  readonly calls = { list: 0, get: 0, put: 0, delete: 0 };

  list(prefix: string): Promise<RemoteObject[]> {
    this.calls.list += 1;
    const matches: RemoteObject[] = [];
    for (const [key, value] of this.objects) {
      if (key.startsWith(prefix)) matches.push({ key, size: value.length });
    }
    matches.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return Promise.resolve(matches);
  }

  get(key: string): Promise<Uint8Array> {
    this.calls.get += 1;
    const value = this.objects.get(key);
    if (!value) return Promise.reject(new ObjectNotFoundError(key));
    return Promise.resolve(value.slice());
  }

  put(key: string, data: Uint8Array): Promise<void> {
    this.calls.put += 1;
    this.objects.set(key, data.slice());
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.calls.delete += 1;
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Test helper: the raw stored bytes, for asserting they are unreadable. */
  raw(key: string): Uint8Array | undefined {
    return this.objects.get(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
