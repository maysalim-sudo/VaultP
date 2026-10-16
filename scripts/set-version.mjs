#!/usr/bin/env node
/**
 * Set the version for a release, everywhere it is written down.
 *
 *   node scripts/set-version.mjs 0.2.0
 *
 * The phone and the computer ship together and are described by one number, so
 * the desktop package, the mobile package, the Expo config and the Android build
 * are kept in step by this rather than by memory. Android also needs a
 * `versionCode` that only ever goes up — the Play Store refuses an upload that
 * does not raise it, and a phone refuses to "update" to a lower one — so that is
 * incremented here too.
 *
 * Writes the files and nothing else: committing and tagging stay deliberate.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.patch>   e.g. 0.2.0');
  process.exit(1);
}

function edit(relative, change) {
  const path = join(root, relative);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`Nothing changed in ${relative} — has its layout moved?`);
  writeFileSync(path, after, 'utf8');
}

const setJsonVersion = (text) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);

edit('package.json', setJsonVersion);
edit('apps/desktop/package.json', setJsonVersion);
edit('apps/mobile/package.json', setJsonVersion);
edit('apps/mobile/app.json', setJsonVersion);

let versionCode = 0;
edit('apps/mobile/android/app/build.gradle', (text) =>
  text
    .replace(/versionCode (\d+)/, (_match, current) => {
      versionCode = Number(current) + 1;
      return `versionCode ${versionCode}`;
    })
    .replace(/versionName "[^"]+"/, `versionName "${version}"`),
);

console.log(`Version ${version} (Android versionCode ${versionCode}).`);
console.log('Next: add the release to CHANGELOG.md, commit, then  git tag v' + version + '  and push the tag.');
