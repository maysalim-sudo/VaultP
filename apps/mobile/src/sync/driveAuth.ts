/**
 * Using the Google connection on the phone.
 *
 * THE PHONE DOES NOT SIGN IN. The connection is made once on the desktop, where
 * there is a browser and a loopback redirect to catch, and the credentials are
 * stored in the vault's own settings — so they replicate here like every other
 * change, sealed under a key derived from the passphrase.
 *
 * That is deliberate rather than a shortcut. Signing in here would need a second
 * OAuth client tied to this app's signing certificate, a second consent screen,
 * and a browser round trip through a custom scheme — a lot of machinery to
 * arrive at credentials the vault already carries. It also means there is one
 * account to revoke rather than two.
 *
 * The consequence to know about: a phone that has never synced with the desktop
 * has no credentials, and says so rather than offering a sign-in that cannot
 * work. Getting them across takes one sync over a folder, or a backup restore.
 */

import {
  fromBase64,
  readSetting,
  type DriveAuth,
  type VaultKeys,
  type VaultStore,
} from '@vaultp/core';

import { androidCryptoProvider } from '../crypto/provider.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Must match the desktop exactly, or neither can read what the other wrote. */
const SETTING = 'drive_credentials';
const AAD = 'vaultp/drive-credentials/v1';

const REFRESH_MARGIN_MS = 60_000;

interface StoredCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly folderName: string;
  readonly connectedAt: string;
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
    const plaintext = await androidCryptoProvider.decrypt(
      keys.credentials,
      fromBase64(raw),
      AAD,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as StoredCredentials;
  } catch {
    // Written by a different vault, or by a build that means something else by
    // this setting. Treated as not connected rather than as a failure.
    return undefined;
  }
}

export interface DriveConnection {
  readonly connected: boolean;
  readonly folderName: string;
  readonly connectedAt: string | null;
}

export async function driveConnection(
  store: VaultStore,
  keys: VaultKeys,
): Promise<DriveConnection> {
  const credentials = await load(store, keys);
  return {
    connected: credentials !== undefined,
    folderName: credentials?.folderName ?? 'VaultP',
    connectedAt: credentials?.connectedAt ?? null,
  };
}

/** Trades the stored refresh token for access tokens, holding none on disk. */
export function driveAuthFor(store: VaultStore, keys: VaultKeys): DriveAuth {
  let cached: { token: string; expiresAt: number } | undefined;

  return {
    async accessToken(): Promise<string> {
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

      const credentials = await load(store, keys);
      if (!credentials) {
        throw new Error(
          'This vault is not connected to Google Drive. Connect it on the desktop, ' +
            'then sync once so the phone receives it.',
        );
      }

      // Form-encoded, so the body is a string — the one shape React Native's
      // fetch is reliable with.
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
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Google refused the sign-in (${response.status}).`);
      }

      const tokens = (await response.json()) as { access_token: string; expires_in: number };
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
