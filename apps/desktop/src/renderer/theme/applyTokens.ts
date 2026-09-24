/**
 * Paints the design tokens onto the document as CSS custom properties.
 *
 * `styles.css` is written entirely in terms of `var(--…)`; this is what gives
 * those variables their values, from the one token source both apps share. It
 * also follows the operating system: when the OS flips between light and dark,
 * the variables are rewritten and the whole window re-themes with no reload.
 *
 * Doing it here rather than as two hand-written `:root` blocks keeps a single
 * source of truth — the desktop and the phone cannot drift, because the numbers
 * live in `@vaultp/core` and nowhere else.
 */

import {
  darkTheme,
  lightTheme,
  numericFeatures,
  radii,
  spacing,
  typeScale,
  type Theme,
} from '@vaultp/core';

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  const { colors, depth } = theme;

  // Colour roles. The short legacy names (--bg, --surface, --warn, …) are kept
  // as aliases so every screen not yet migrated keeps rendering unchanged.
  set('--bg', colors.bg);
  set('--surface', colors.surfaceRaised);
  set('--surface-raised', colors.surfaceRaised);
  set('--surface-overlay', colors.surfaceOverlay);
  set('--text', colors.text);
  set('--dim', colors.textDim);
  set('--text-dim', colors.textDim);
  set('--text-faint', colors.textFaint);
  set('--border', colors.border);
  set('--divider', colors.divider);
  set('--accent', colors.accent);
  set('--on-accent', colors.onAccent);
  set('--positive', colors.positive);
  set('--negative', colors.negative);
  set('--estimate', colors.estimate);
  set('--success', colors.success);
  set('--warning', colors.warning);
  set('--warn', colors.warning);
  set('--danger', colors.danger);

  set('--shadow-card', depth.shadowCard);
  set('--shadow-overlay', depth.shadowOverlay);

  // Scales.
  for (const [name, value] of Object.entries(typeScale)) set(`--text-${name}`, `${value}px`);
  for (const [name, value] of Object.entries(spacing)) set(`--space-${name}`, `${value}px`);
  for (const [name, value] of Object.entries(radii)) set(`--radius-${name}`, `${value}px`);
  set('--numeric', numericFeatures);

  // Lets the browser render native form controls and scrollbars for the theme.
  root.style.colorScheme = theme === darkTheme ? 'dark' : 'light';
}

/**
 * Apply the OS theme now and whenever it changes. Returns a disposer, though in
 * practice this lives for the life of the window.
 */
export function installTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const paint = () => applyTheme(query.matches ? darkTheme : lightTheme);

  paint();
  query.addEventListener('change', paint);
  return () => query.removeEventListener('change', paint);
}
