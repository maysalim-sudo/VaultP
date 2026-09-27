/**
 * Note images in the window: decrypted on request by the main process, kept as
 * data URLs in memory only, and remembered by file id so a grid of cards does
 * not decrypt the same picture on every render.
 */

import { useEffect, useState } from 'react';

import { api, messageOf } from '../vault.js';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/** Keep memory bounded: a few dozen decoded images is plenty for one screen. */
const LIMIT = 60;

function load(fileId: string): Promise<string> {
  const known = cache.get(fileId);
  if (known) return Promise.resolve(known);

  let request = pending.get(fileId);
  if (!request) {
    request = api()
      .noteImage(fileId)
      .then((url) => {
        cache.set(fileId, url);
        if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
        return url;
      })
      .finally(() => pending.delete(fileId));
    pending.set(fileId, request);
  }
  return request;
}

export type ImageState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'missing'; reason: string };

export function useNoteImage(fileId: string): ImageState {
  const [state, setState] = useState<ImageState>(() => {
    const known = cache.get(fileId);
    return known ? { status: 'ready', url: known } : { status: 'loading' };
  });

  useEffect(() => {
    let live = true;
    void load(fileId)
      .then((url) => live && setState({ status: 'ready', url }))
      .catch((caught: unknown) => {
        const message = messageOf(caught);
        // Most often the image was added on the phone and its bytes have not
        // come across yet. Say so, rather than show a broken picture.
        if (live) {
          setState({
            status: 'missing',
            reason: /not on this computer/i.test(message) ? 'Not on this computer yet — sync to fetch it' : message,
          });
        }
      });
    return () => {
      live = false;
    };
  }, [fileId]);

  return state;
}

/** Read an image file's pixel size in the window, before sending its bytes over. */
export async function imageSize(blob: Blob): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}
