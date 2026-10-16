/**
 * Going somewhere, and opening something when you get there.
 *
 * The window has no router: one screen at a time, picked from the sidebar. What
 * search and the dashboard's quick actions add is arriving with a purpose —
 * open this note, start a new checklist — so a screen is told, once, what it was
 * opened for, and does it. The purpose is consumed on arrival; coming back to
 * the screen later does not reopen the same thing.
 */

import { createContext, useContext, useEffect, useRef } from 'react';

import type { ScreenId } from './Sidebar.js';

export type Intent =
  | { readonly kind: 'note'; readonly id: string }
  | { readonly kind: 'newNote'; readonly with: 'text' | 'checklist' | 'image' }
  | { readonly kind: 'expense'; readonly id: string }
  | { readonly kind: 'newExpense' }
  | { readonly kind: 'person'; readonly id: string }
  | { readonly kind: 'newPerson' }
  | { readonly kind: 'document'; readonly id: string }
  | { readonly kind: 'newDocument' }
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'newAccount' };

export interface Navigation {
  readonly screen: ScreenId;
  /** Bumped by every go, so a screen already showing still hears a new intent. */
  readonly version: number;
  go(screen: ScreenId, intent?: Intent): void;
  /** The intent the current screen was opened with, if it has not been used. */
  take(screen: ScreenId): Intent | null;
}

export const NavContext = createContext<Navigation | null>(null);

export function useNav(): Navigation {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside the window shell.');
  return nav;
}

/**
 * Run `handle` with the intent this screen was opened with — on arrival, and
 * again whenever a new one is sent while the screen is already showing (a
 * second search result in the same screen).
 */
export function useIntent(screen: ScreenId, handle: (intent: Intent) => void): void {
  const nav = useNav();
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    const intent = nav.take(screen);
    if (intent) handler.current(intent);
    // The version changes whenever an intent is sent; that is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.version]);
}
