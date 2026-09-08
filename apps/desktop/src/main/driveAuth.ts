/**
 * Signing in to Google, on the desktop.
 *
 * Authorization code with PKCE, through a loopback redirect: the system browser
 * does the sign-in, a one-shot HTTP server on 127.0.0.1 catches the redirect,
 * and the code is exchanged here. The app never sees the Google password, and
 * nothing is typed into a window this program drew — which is the point of
 * doing it in the real browser rather than an embedded one.
 *
 * THE USER BRINGS THEIR OWN CLIENT. There is no client id baked into this
 * build. A public repository cannot hold a credential, and this app promises not
 * to hold an account with anybody — so if you want your vault in your Drive, it
 * goes through your own Google Cloud project, under your own quota. The README
 * says how to make one.
 *
 * Credentials are sealed with a key derived from the passphrase, so they are
 * protected exactly as well as the vault is. A locked vault therefore cannot
 * sync: nothing can reach the refresh token until someone opens it, which is the
 * correct trade and not an oversight.
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { shell } from 'electron';
import type { AddressInfo } from 'node:net';

import {
  fromBase64,
  toBase64,
  webCryptoProvider,
  writeSetting,
  readSetting,
  type DriveAuth,
  type VaultStore,
  type VaultKeys,
} from '@vaultp/core';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Only files this app creates.
 *
 * Not `drive`, and not `drive.readonly`: with this scope the token cannot read
 * anything else in the account, so a mistake in this code — or a stolen token —
 * still reaches nothing but the vault's own folder.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const SETTING = 'drive_credentials';
const AAD = 'vaultp/drive-credentials/v1';

/** How long before a token's stated expiry to fetch a new one. */
const REFRESH_MARGIN_MS = 60_000;

interface StoredCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly folderName: string;
  readonly connectedAt: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ------------------------------------------------------------------ storage

async function save(
  store: VaultStore,
  keys: VaultKeys,
  credentials: StoredCredentials,
): Promise<void> {
  const sealed = await webCryptoProvider.encrypt(
    keys.credentials,
    new TextEncoder().encode(JSON.stringify(credentials)),
    AAD,
  );
  // Into the vault's own settings, so it is carried by backup and restore like
  // everything else — and encrypted a second time, under a key of its own,
  // because a refresh token is a standing grant rather than a preference.
  writeSetting(store, SETTING, toBase64(sealed));
}

async function load(
  store: VaultStore,
  keys: VaultKeys,
): Promise<StoredCredentials | undefined> {
  const raw = readSetting<string>(
    store,
    SETTING,
    '',
    (value): value is string => typeof value === 'string',
  );
  if (raw === '') return undefined;

  try {
    const plaintext = await webCryptoProvider.decrypt(keys.credentials, fromBase64(raw), AAD);
    return JSON.parse(new TextDecoder().decode(plaintext)) as StoredCredentials;
  } catch {
    // Written by a different vault, or corrupt. Treated as not connected rather
    // than as a failure that stops the app opening.
    return undefined;
  }
}

export function forget(store: VaultStore): void {
  writeSetting(store, SETTING, '');
}

export async function connection(
  store: VaultStore,
  keys: VaultKeys,
): Promise<{ connected: boolean; folderName: string; connectedAt: string | null }> {
  const credentials = await load(store, keys);
  return {
    connected: credentials !== undefined,
    folderName: credentials?.folderName ?? 'VaultP',
    connectedAt: credentials?.connectedAt ?? null,
  };
}

// -------------------------------------------------------------------- flow

/**
 * Catch one redirect on the loopback interface.
 *
 * Port zero: the operating system picks a free one, which is then part of the
 * redirect URI. Nothing is left listening — the server is closed the moment the
 * code arrives, or when the wait times out.
 */
function awaitRedirect(state: string): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: (code: string) => void;
    let fail: (error: Error) => void;
    const code = new Promise<string>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const reply = (message: string) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><meta charset="utf-8"><title>VaultP</title>` +
            `<body style="font:16px system-ui;padding:48px;background:#121417;color:#f8f9fa">` +
            `<h1 style="font-size:20px">${message}</h1>` +
            `<p style="color:#868e96">You can close this tab and go back to VaultP.</p>`,
        );
      };

      const error = url.searchParams.get('error');
      if (error) {
        reply('Sign-in was cancelled.');
        fail(new Error(`Google refused the sign-in: ${error}`));
        server.close();
        return;
      }

      // The state must match, or this redirect belongs to someone else's request.
      if (url.searchParams.get('state') !== state) {
        reply('That sign-in did not match this request.');
        fail(new Error('The sign-in response did not match the request.'));
        server.close();
        return;
      }

      const received = url.searchParams.get('code');
      if (!received) return;

      reply('Connected.');
      settle(received);
      server.close();
    });

    server.on('error', rejectServer);
    // Loopback only: nothing on the network can reach this, even briefly.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;

      const timer = setTimeout(
        () => {
          server.close();
          fail(new Error('Timed out waiting for the Google sign-in to finish.'));
        },
        5 * 60_000,
      );
      void code.catch(() => undefined).finally(() => clearTimeout(timer));

      resolveServer({ port, code });
    });
  });
}

export interface ConnectInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly folderName: string;
}

/** Run the sign-in and store what it produces. */
export async function connect(
  store: VaultStore,
  keys: VaultKeys,
  input: ConnectInput,
): Promise<{ folderName: string }> {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (clientId === '') throw new Error('A Google client ID is required.');

  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(new Uint8Array(createHash('sha256').update(verifier).digest()));
  const state = base64Url(randomBytes(16));

  const { port, code } = await awaitRedirect(state);
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  // Google only issues a refresh token when asked, and only the first time
  // unless consent is forced. Without one, the connection would last an hour.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  await shell.openExternal(authUrl.toString());

  const authorizationCode = await code;

  const body = new URLSearchParams({
    client_id: clientId,
    code: authorizationCode,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  // Google issues a secret for desktop clients and requires it here, while
  // being clear it is not confidential. PKCE is what actually protects the
  // exchange.
  if (clientSecret !== '') body.set('client_secret', clientSecret);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(await tokenError(response));

  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove VaultP from your account ' +
        'permissions and connect again, so it asks for consent afresh.',
    );
  }

  const folderName = input.folderName.trim() === '' ? 'VaultP' : input.folderName.trim();
  await save(store, keys, {
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
    folderName,
    connectedAt: new Date().toISOString(),
  });

  return { folderName };
}

// -------------------------------------------------------------------- auth

/**
 * A DriveAuth that trades the stored refresh token for access tokens.
 *
 * The access token is held in memory only, and only for as long as it is valid.
 */
export function driveAuthFor(store: VaultStore, keys: VaultKeys): DriveAuth {
  let cached: { token: string; expiresAt: number } | undefined;

  return {
    async accessToken(): Promise<string> {
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

      const credentials = await load(store, keys);
      if (!credentials) {
        throw new Error('This vault is not connected to Google Drive.');
      }

      const body = new URLSearchParams({
        client_id: credentials.clientId,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      });
      if (credentials.clientSecret !== '') {
        body.set('client_secret', credentials.clientSecret);
      }

      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) throw new Error(await tokenError(response));

      const tokens = (await response.json()) as TokenResponse;
      cached = {
        token: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };
      return cached.token;
    },

    invalidate(): void {
      cached = undefined;
    },
  };
}

export async function folderNameFor(store: VaultStore, keys: VaultKeys): Promise<string> {
  return (await load(store, keys))?.folderName ?? 'VaultP';
}

async function tokenError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error_description?: string; error?: string };
    const detail = body.error_description ?? body.error;
    if (detail) return `Google refused the sign-in: ${detail}`;
  } catch {
    // Not JSON.
  }
  return `Google refused the sign-in (${response.status}).`;
}
