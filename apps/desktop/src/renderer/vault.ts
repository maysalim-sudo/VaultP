/**
 * Talking to the vault from the window.
 *
 * The renderer keeps no copy of anything. Every screen asks the main process for
 * what it needs and re-asks when something changes, because the vault can also
 * change underneath it — a sync pulls in whatever the phone did, and a screen
 * holding its own cached list would quietly show the state from before.
 *
 * `revision` is that signal: any mutation bumps it, every query re-runs.
 */

import { useCallback, useEffect, useState } from 'react';

import type { VaultpApi } from '../shared/api.js';

declare global {
  interface Window {
    readonly vaultp: VaultpApi;
  }
}

export const api = (): VaultpApi => window.vaultp;

/**
 * The vault's base currency, learned once from the main process.
 *
 * Only ever used to decide whether an amount needs a converted figure shown
 * beside it. Nothing in the window computes with it — that all happens on the
 * other side of the bridge, where the currency table lives.
 */
let base = 'TND';
export function setBaseCurrency(code: string): void {
  base = code;
}
export function baseCurrency(): string {
  return base;
}

let revision = 0;
const listeners = new Set<() => void>();

/** Tell every live query that the vault has moved on. */
export function invalidate(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

// The vault can also move on without the window asking — a scan's text arrives
// after the import that started it. Same signal, so no screen needs to know.
api().onVaultChanged(invalidate);

function useRevision(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return revision;
}

export interface Query<T> {
  readonly data: T | undefined;
  readonly error: string | null;
}

/**
 * Run a read against the vault, and run it again whenever the vault changes.
 *
 * A stale response is dropped rather than applied: two reloads in flight at once
 * would otherwise land in whichever order the main process happened to finish.
 */
export function useVaultQuery<T>(load: () => Promise<T>, enabled = true): Query<T> {
  const at = useRevision();
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;

    void load()
      .then((value) => {
        if (current) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (current) setError(messageOf(caught));
      });

    return () => {
      current = false;
    };
    // `load` is a fresh closure each render; the revision is what decides a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, enabled]);

  return { data, error };
}

/** Electron wraps the original message; the useful part is after the colon. */
export function messageOf(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.replace(/^Error invoking remote method '[^']+': /, '');
}

export interface Runner {
  readonly busy: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
  /** Run a mutation, surface its failure, and refresh every screen after it. */
  readonly run: (action: () => Promise<unknown>) => Promise<void>;
}

export function useRunner(): Runner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      invalidate();
    } catch (caught: unknown) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clearError: useCallback(() => setError(null), []) };
}
