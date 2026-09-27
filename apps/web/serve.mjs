/**
 * Preview the site locally, as Vercel will serve it.
 *
 * Reads the headers from vercel.json and applies them, so the Content Security
 * Policy is exercised here too: a page that only works without its CSP would
 * break the moment it is deployed. No dependencies — plain Node.
 *
 *   node apps/web/serve.mjs        then open http://localhost:4173
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function headersFor(path) {
  const out = {};
  for (const rule of config.headers) {
    const pattern = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (pattern.test(path)) for (const { key, value } of rule.headers) out[key] = value;
  }
  // HSTS on localhost would pin the browser to https for it; leave it to Vercel.
  delete out['Strict-Transport-Security'];
  return out;
}

createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
  if (path === '/') path = '/index.html';
  // cleanUrls: /privacy serves privacy.html, as on Vercel.
  if (!extname(path)) path += '.html';

  const file = normalize(join(root, path));
  if (!file.startsWith(root) || file.endsWith('.mjs') || file.endsWith('.json')) {
    response.writeHead(404).end('Not found');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      ...headersFor(path),
    });
    response.end(body);
  } catch {
    response.writeHead(404, headersFor(path)).end('Not found');
  }
}).listen(port, () => console.log(`VaultP site on http://localhost:${port}`));
