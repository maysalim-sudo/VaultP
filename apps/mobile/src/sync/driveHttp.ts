/**
 * Talking to Google Drive from the phone.
 *
 * WHY THIS EXISTS AT ALL. React Native's `fetch` cannot send bytes. It takes a
 * string, form data, or a Blob — and a Blob cannot be built from a typed array
 * there, which is the one thing a sync backend needs to do. So anything with a
 * binary body goes through a file: the bytes are written to the cache, uploaded
 * from disk, and the file removed. Downloads come back the same way.
 *
 * Everything that decides *what* to send — the token, the retries, the object
 * keys — stays in core, the same code the desktop runs. Only the wire is
 * different, because only the wire has to be.
 */

import { Directory, File, Paths, UploadType } from 'expo-file-system';

import type { DriveHttp, DriveResponse } from '@vaultp/core';

/** Scratch space for one request. Cleared as soon as the bytes are handed over. */
const TRANSFER_CACHE = 'vault-drive';

function transferDirectory(): Directory {
  const directory = new Directory(Paths.cache, TRANSFER_CACHE);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function temporary(): File {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
  return new File(transferDirectory(), name);
}

function respond(status: number, headers: Record<string, string>, body: () => Promise<Uint8Array>): DriveResponse {
  const retryAfter = Number(headers['retry-after'] ?? headers['Retry-After']);

  return {
    status,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    async text() {
      return new TextDecoder().decode(await body());
    },
    bytes: body,
  };
}

export function phoneDriveHttp(): DriveHttp {
  return {
    async send(request) {
      const wantsBytes = request.url.includes('alt=media');

      // Bytes out: through a file, because the body cannot be a typed array.
      if (request.body !== undefined && typeof request.body !== 'string') {
        const scratch = temporary();
        scratch.create();
        scratch.write(request.body);

        try {
          const result = await scratch.upload(request.url, {
            httpMethod: request.method as 'POST' | 'PUT' | 'PATCH',
            uploadType: UploadType.BINARY_CONTENT,
            headers: { ...request.headers },
          });

          const encoded = new TextEncoder().encode(result.body);
          return respond(result.status, result.headers, () => Promise.resolve(encoded));
        } finally {
          // The plaintext here is already ciphertext, but a stale copy in the
          // cache is still a copy of the vault sitting outside it.
          if (scratch.exists) scratch.delete();
        }
      }

      // Bytes in: downloaded to a file, read, and the file removed.
      if (wantsBytes) {
        const destination = temporary();
        try {
          const downloaded = await File.downloadFileAsync(request.url, destination, {
            headers: { ...request.headers },
            idempotent: true,
          });
          const bytes = await downloaded.bytes();
          return respond(200, {}, () => Promise.resolve(bytes));
        } catch (caught: unknown) {
          // downloadFileAsync throws rather than reporting a status, so a
          // refusal has to be surfaced as one core will recognise. 401 is not
          // guessed at: it would send the user to sign in again over what may
          // be a missing object.
          const message = caught instanceof Error ? caught.message : String(caught);
          const encoded = new TextEncoder().encode(
            JSON.stringify({ error: { message } }),
          );
          return respond(/\b404\b/.test(message) ? 404 : 500, {}, () =>
            Promise.resolve(encoded),
          );
        } finally {
          if (destination.exists) destination.delete();
        }
      }

      // Everything else is JSON in and JSON out, which plain fetch handles.
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(request.body === undefined ? {} : { body: request.body }),
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });

      const text = await response.text();
      const encoded = new TextEncoder().encode(text);
      return respond(response.status, headers, () => Promise.resolve(encoded));
    },
  };
}

/** Remove anything a cancelled transfer left behind. Called on unlock. */
export function clearDriveTransfers(): void {
  const directory = new Directory(Paths.cache, TRANSFER_CACHE);
  if (directory.exists) directory.delete();
}
