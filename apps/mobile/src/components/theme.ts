/**
 * The phone's palette, derived from the shared design tokens.
 *
 * The colours no longer live here — they live in `@vaultp/core` design tokens,
 * the same source the desktop draws from, so the two devices cannot drift. This
 * file only *adapts* them into the shape the screens already expect, and adds a
 * few roles the richer language introduced. Every field the existing screens
 * read is still here, so nothing outside the redesigned screens has to change.
 */

import { darkTheme, lightTheme, type Theme } from '@vaultp/core';

export interface Palette {
  readonly background: string;
  readonly surface: string;
  /** A surface lifted above the card layer: pressed rows, inputs, the drawer's fill. */
  readonly surfaceOverlay: string;
  readonly text: string;
  readonly dim: string;
  /** The least important line: placeholders, faint metadata. */
  readonly textFaint: string;
  /** A pressed/disabled fill. */
  readonly key: string;
  readonly ripple: string;
  readonly border: string;
  readonly divider: string;
  readonly accent: string;
  /** Text/icons printed on the accent. */
  readonly onAccent: string;
  readonly danger: string;
  readonly success: string;
  readonly warning: string;
  /** Owed to you. */
  readonly positive: string;
  /** You owe / overspent. */
  readonly negative: string;
  /** The `≈` state — provisional, neither fact nor error. */
  readonly estimate: string;
  /** Android elevation for a card / for an overlay. */
  readonly elevationCard: number;
  readonly elevationOverlay: number;
}

function paletteFromTheme(theme: Theme): Palette {
  const c = theme.colors;
  return {
    background: c.bg,
    surface: c.surfaceRaised,
    surfaceOverlay: c.surfaceOverlay,
    text: c.text,
    dim: c.textDim,
    textFaint: c.textFaint,
    key: c.surfaceOverlay,
    ripple: c.border,
    border: c.border,
    divider: c.divider,
    accent: c.accent,
    onAccent: c.onAccent,
    danger: c.danger,
    success: c.success,
    warning: c.warning,
    positive: c.positive,
    negative: c.negative,
    estimate: c.estimate,
    elevationCard: theme.depth.rnElevationCard,
    elevationOverlay: theme.depth.rnElevationOverlay,
  };
}

export const lightPalette: Palette = paletteFromTheme(lightTheme);
export const darkPalette: Palette = paletteFromTheme(darkTheme);

/**
 * React Native reports 'unspecified' as well as light/dark, so the parameter is
 * widened rather than narrowed at each call site. Anything not explicitly dark
 * renders light — and the light theme is now a considered first-class theme, not
 * a washed-out fallback.
 */
export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? darkPalette : lightPalette;
}
