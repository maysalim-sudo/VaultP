/**
 * Puts the right build of the SQLite driver in place before the app or the tests
 * run.
 *
 * `better-sqlite3-multiple-ciphers` is a compiled binary, and a build for Node
 * cannot be loaded by Electron. They are different ABIs — Node 24 is module
 * version 137, Electron 33 is 130 — and the mismatch surfaces only when
 * something opens a database, which is the first thing that happens after a
 * passphrase is accepted. The app looks fine right up to the moment it matters.
 *
 * Both are needed: the app runs under Electron, and the desktop tests open real
 * encrypted databases under Node.
 *
 * Keeping a second copy nested in apps/desktop/node_modules does not separate
 * them. Node resolution walks up from the importing file, and the app's modules
 * and the test files live in the same package — both reach the same nested copy
 * first. Whatever is there is what both get.
 *
 * So there is one slot, and this swaps it. Each build is cached the first time it
 * is fetched, which makes every later swap a file copy. Binaries are downloaded
 * rather than compiled, so no C++ toolchain is needed — on Windows that would
 * otherwise be a multi-gigabyte prerequisite for a personal expense tracker.
 *
 * The consequence to know about: the app and the tests cannot run at the same
 * time. Each is preceded by its own swap, so in practice you only notice if you
 * leave the app open while running tests.
 *
 * Usage: node scripts/native.mjs <electron|node>
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE = 'better-sqlite3-multiple-ciphers';
const BINARY = 'better_sqlite3.node';

const runtime = process.argv[2];
if (runtime !== 'electron' && runtime !== 'node') {
  throw new Error(`Usage: node scripts/native.mjs <electron|node> (got ${runtime})`);
}

// fileURLToPath, not the URL's own pathname: on Windows that is
// "/E:/Data%20From%20Desktop/..." — leading slash, percent-encoded spaces — and
// using it directly writes to a directory literally named "Data%20From Desktop".
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const modulePath = dirname(require.resolve(`${MODULE}/package.json`));
const installed = join(modulePath, 'build', 'Release', BINARY);
const marker = join(modulePath, '.vaultp-runtime');

const cache = join(here, '..', '.native-cache');

function version() {
  if (runtime === 'node') return process.versions.modules;
  return JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
}

const target = version();
const tag = `${runtime}-${target}`;
const cached = join(cache, tag, BINARY);

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === tag) {
  console.log(`${MODULE}: already built for ${tag}.`);
  process.exit(0);
}

if (existsSync(cached)) {
  copyFileSync(cached, installed);
} else {
  console.log(`${MODULE}: fetching a prebuilt binary for ${tag}…`);

  // prebuild-install's own entry point under this Node, rather than the npx
  // shim: Node 24 on Windows refuses to spawn a .cmd without a shell, and going
  // through a shell to run a program we can already locate only adds a way to
  // fail.
  execFileSync(
    process.execPath,
    [
      require.resolve('prebuild-install/bin.js'),
      ...(runtime === 'electron' ? ['--runtime', 'electron', '--target', target] : []),
      '--force',
    ],
    { cwd: modulePath, stdio: 'inherit' },
  );

  mkdirSync(join(cache, tag), { recursive: true });
  copyFileSync(installed, cached);
}

writeFileSync(marker, `${tag}\n`, 'utf8');
console.log(`${MODULE}: ready for ${tag}.`);
