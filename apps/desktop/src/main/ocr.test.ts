/**
 * Reading text out of an image, offline.
 *
 * The assertion that matters is not "Tesseract works" — it is that this build
 * finds its language data on disk and recognises without asking the network for
 * anything. A run that quietly fell back to fetching from a CDN would still
 * produce the right text, so `fetch` is taken away for the duration.
 *
 * Slow: the first recognition starts a WebAssembly worker and unpacks three
 * languages. It runs once, and the worker is shared by the cases below.
 */

import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { canRecognise, recogniseText, shutdownOcr } from './ocr.js';

/**
 * A 1-bit BMP saying VAULT, drawn from a small bitmap font.
 *
 * Letters that stay distinct when drawn as 5x7 blocks. P is deliberately absent:
 * at this resolution its bowl reads as an F, which says something about the
 * font and nothing about the recogniser.
 *
 * Built rather than checked in so the test carries its own expected answer:
 * a fixture image would say what it says, and nothing here could tell whether
 * the recogniser or the fixture had drifted.
 */
const GLYPHS: Record<string, readonly string[]> = {
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  A: ['  #  ', ' # # ', '#   #', '#   #', '#####', '#   #', '#   #'],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
};

const SCALE = 12;
const MARGIN = 40;

/** Uncompressed 24-bit BMP: no encoder dependency, and Tesseract reads it. */
function renderBmp(word: string): Uint8Array {
  const glyphRows = GLYPHS[word[0]!]!.length;
  const cellWidth = GLYPHS[word[0]!]![0]!.length + 1;

  const width = MARGIN * 2 + word.length * cellWidth * SCALE;
  const height = MARGIN * 2 + glyphRows * SCALE;

  // Rows are padded to a multiple of four bytes.
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = new Uint8Array(rowSize * height).fill(0xff);

  const plot = (x: number, y: number) => {
    // BMP rows run bottom to top.
    const offset = (height - 1 - y) * rowSize + x * 3;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  };

  word.split('').forEach((character, index) => {
    const glyph = GLYPHS[character]!;
    glyph.forEach((line, row) => {
      line.split('').forEach((cell, column) => {
        if (cell !== '#') return;
        for (let dy = 0; dy < SCALE; dy += 1) {
          for (let dx = 0; dx < SCALE; dx += 1) {
            plot(
              MARGIN + (index * cellWidth + column) * SCALE + dx,
              MARGIN + row * SCALE + dy,
            );
          }
        }
      });
    });
  });

  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);

  return new Uint8Array(Buffer.concat([header, Buffer.from(pixels)]));
}

/** The same image with nothing drawn on it. */
function blankBmp(): Uint8Array {
  const image = renderBmp('L');
  // Everything after the 54-byte header back to white.
  image.fill(0xff, 54);
  return image;
}

const roots: string[] = [];

afterAll(async () => {
  await shutdownOcr();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('what can be read', () => {
  it('accepts images and declines everything else', () => {
    expect(canRecognise('image/jpeg')).toBe(true);
    expect(canRecognise('image/png')).toBe(true);
    // A PDF is a container; pulling pages out of one is a different job.
    expect(canRecognise('application/pdf')).toBe(false);
    expect(canRecognise(null)).toBe(false);
    expect(canRecognise('image/heic')).toBe(false);
  });
});

describe('recognition', () => {
  it('reads text from an image without touching the network', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vaultp-ocr-'));
    roots.push(root);

    // Anything reaching for a CDN fails loudly instead of silently working.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('OCR must not use the network');
    }) as typeof fetch;

    try {
      const text = await recogniseText(root, renderBmp('VAULT'));
      expect(text?.toUpperCase()).toContain('VAULT');
    } finally {
      globalThis.fetch = realFetch;
    }

    // The language data was copied out of node_modules, which is what the
    // recogniser read. Nothing arrived over a wire.
    await expect(access(join(root, 'tessdata', 'eng.traineddata.gz'))).resolves.toBeUndefined();
  }, 240_000);

  it('says nothing was found rather than returning an empty string', async () => {
    // A blank page is an ordinary outcome — a photo of a key, an overexposed
    // scan — and must not read as a document whose text is "".
    const text = await recogniseText(roots[0]!, blankBmp());
    expect(text).toBeUndefined();
  }, 120_000);
});
