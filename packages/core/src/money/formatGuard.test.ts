import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Screens print amounts through `formatAmount` and nothing else.
 *
 * Three formatters once lived side by side — core's, one inside the phone's
 * Home screen, and the desktop's plain decimal — and the same month's spending
 * read "128,250 DT" on one screen and "123.750 TND" on the next. This keeps a
 * local one from creeping back in.
 */

const appsRoot = fileURLToPath(new URL('../../../../apps/', import.meta.url));
const SOURCE_DIRS = ['mobile/src', 'desktop/src/renderer'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/Intl\.NumberFormat/, 'a local number formatter'],
  [/formatMoney\(/, 'formatMoney (locale-dependent); use formatAmount'],
  [/['"`>]\s*DT\s*['"`<]|\bDT['"`]/, 'the "DT" label; amounts say TND'],
];

describe('one amount formatter', () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(appsRoot, dir)));

  it('finds the app sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('no screen uses %s', (pattern, what) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders, `uses ${what}`).toEqual([]);
  });
});
