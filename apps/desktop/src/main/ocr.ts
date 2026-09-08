/**
 * Reading the text out of a scan, on this machine.
 *
 * The phone does this with an Android on-device model. The desktop has no such
 * thing, so it runs Tesseract compiled to WebAssembly in this process. Same
 * promise either way: the image never leaves the device, and no OCR service is
 * ever asked anything about it.
 *
 * NOTHING IS DOWNLOADED AT RECOGNITION TIME. Tesseract.js will happily fetch its
 * language data from a CDN on first use, which would make a headline feature
 * quietly depend on the network and hand a third party a request every time a
 * passport is scanned. The data is an ordinary dependency instead, copied out of
 * node_modules into the vault directory once, and `langPath` points there — so
 * this works on a machine that has never been online.
 *
 * The worker is expensive to start and cheap to keep, so it is created on first
 * use and reused. It holds no vault state: plaintext bytes go in, text comes
 * out, and it is torn down when the app quits.
 */

import { createRequire } from 'node:module';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

const require = createRequire(import.meta.url);

/**
 * English, French and Arabic together.
 *
 * A Tunisian document is routinely two of these at once — an Arabic heading over
 * a French form — and Tesseract handles that far better when told to expect it
 * than when run once per language.
 */
const LANGUAGES = ['eng', 'fra', 'ara'] as const;
const LANGUAGE_SPEC = LANGUAGES.join('+');

/** The "fast" models. Meaningfully quicker, and this is a search aid, not a scan. */
const DATA_VARIANT = '4.0.0';

const TESSDATA = 'tessdata';

let worker: Worker | undefined;
let starting: Promise<Worker> | undefined;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the language data where Tesseract will look, copying it out of
 * node_modules the first time. A file copy, not a download.
 */
async function ensureLanguageData(root: string): Promise<string> {
  const directory = join(root, TESSDATA);
  await mkdir(directory, { recursive: true });

  for (const language of LANGUAGES) {
    const target = join(directory, `${language}.traineddata.gz`);
    if (await exists(target)) continue;

    const packageRoot = dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
    await copyFile(join(packageRoot, DATA_VARIANT, `${language}.traineddata.gz`), target);
  }

  return directory;
}

async function ready(root: string): Promise<Worker> {
  if (worker) return worker;
  // Two imports in quick succession must not each start a worker; the second
  // waits on the first rather than paying the start-up cost again.
  starting ??= start(root);
  return starting;
}

async function start(root: string): Promise<Worker> {
  const langPath = await ensureLanguageData(root);
  const corePath = dirname(require.resolve('tesseract.js-core/package.json'));

  const created = await createWorker(LANGUAGE_SPEC, undefined, {
    langPath,
    corePath,
    // Unzipped data is written here rather than back into node_modules, which a
    // reinstall would wipe and which may not be writable at all.
    cachePath: join(root, TESSDATA),
    gzip: true,
  });

  worker = created;
  return created;
}

/** Whether a scan of this type can be read at all. */
export function canRecognise(mime: string | null): boolean {
  // Tesseract reads images. A PDF is a container, and pulling pages out of one
  // is a different job than this — so it is declined rather than half-done.
  return mime !== null && mime.startsWith('image/') && mime !== 'image/heic';
}

/**
 * Recognise text in an image.
 *
 * Returns undefined rather than throwing when nothing readable is found: a
 * photo of a key or a blurry receipt is an ordinary outcome, not a failure, and
 * the document is still worth filing.
 */
export async function recogniseText(
  root: string,
  image: Uint8Array,
): Promise<string | undefined> {
  const instance = await ready(root);
  const result = await instance.recognize(Buffer.from(image));
  const text = result.data.text.trim();
  return text === '' ? undefined : text;
}

/** Stop the worker. Called on quit; starting a new one is always possible. */
export async function shutdownOcr(): Promise<void> {
  const running = worker;
  worker = undefined;
  starting = undefined;
  if (running) await running.terminate();
}
