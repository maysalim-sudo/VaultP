/**
 * The design language, as data.
 *
 * One source of truth for both apps: the desktop turns these into CSS custom
 * properties, the phone turns them into a React Native palette, and neither
 * decides a colour or a size of its own. Change a value here and both devices
 * move together — which is the whole point, and what makes reconciling a new
 * direction (from Stitch, say) a one-file edit rather than two that drift.
 *
 * Deliberately pure data: no React, no platform APIs, no imports. That is what
 * lets it live in core beside the money logic without breaking the rule that
 * core knows nothing about UI — these are values, not components.
 *
 * THE LOOK IS INDUSTRIAL (approved 2026-10-30, docs/ux/industrial/). Black or
 * warm paper, soft-cornered tiles, figures on a dot-matrix face, and one safety
 * orange that is spent only where something wants you: the create button, the
 * next bill, money you owe, a budget past 80%, today. Everything else is ink.
 * Green is money coming back; a cool blue-grey marks an estimate. Nothing about
 * money is red — orange is a nudge, not an alarm — and red is kept for the one
 * job of destructive actions.
 *
 * Every text colour here is checked against the surfaces it sits on, in both
 * themes, by design/tokens.test.ts: WCAG AA (4.5:1) for all of them, faint
 * captions included. The orange is too light to read as small text on paper, so
 * the light theme prints it through `accentText`, a burnt cut of the same hue.
 */

/** A complete set of colour roles for one theme. Every field is required in both. */
export interface ColorRoles {
  /** The window/page ground. */
  readonly bg: string;
  /** A surface lifted off the ground: cards, list groups. */
  readonly surfaceRaised: string;
  /** Lifted again: modals, inputs, hovered rows. */
  readonly surfaceOverlay: string;

  readonly text: string;
  /** Secondary text: labels, captions, metadata. */
  readonly textDim: string;
  /** Tertiary text: placeholders, the least important line. */
  readonly textFaint: string;

  readonly border: string;
  readonly divider: string;

  /** The safety orange, as a fill: the create button, today, the next bill. */
  readonly accent: string;
  /** Text/icons printed on top of the accent. */
  readonly onAccent: string;
  /** The orange as text or a thin stroke on the ground or a tile. */
  readonly accentText: string;

  // The money meanings, named rather than signed — "-200" reads as either the
  // moment attention lapses.
  /** Owed to you; money coming back. */
  readonly positive: string;
  /** You owe; overspent. Cautionary, not alarming — orange, never red. */
  readonly negative: string;
  /**
   * The `≈` state: a value derived from a past rate, not a fact and not an
   * error. Cool on purpose, so it reads as provisional against the accent.
   */
  readonly estimate: string;

  readonly success: string;
  /** Deadlines and expiries stepping closer. */
  readonly warning: string;
  /** Destructive actions only (delete, discard). Not for money or dates. */
  readonly danger: string;
}

/**
 * Depth, expressed the way each medium actually shows it.
 *
 * On dark, shadows barely register, so depth is carried by the surface steps
 * above and only hinted with a shadow; on light, a soft shadow does the work.
 * `rnElevation` is the Android-native elevation number for the same intent,
 * since React Native draws shadows through that rather than a CSS string.
 */
export interface Depth {
  readonly shadowCard: string;
  readonly shadowOverlay: string;
  readonly rnElevationCard: number;
  readonly rnElevationOverlay: number;
}

export interface Theme {
  readonly colors: ColorRoles;
  readonly depth: Depth;
}

export const darkColors: ColorRoles = {
  bg: '#000000',
  surfaceRaised: '#111111',
  surfaceOverlay: '#1C1C1C',

  text: '#F4F4F1',
  textDim: '#A6A6A2',
  textFaint: '#8C8C88',

  border: '#262626',
  divider: '#262626',

  accent: '#FF5A1F',
  onAccent: '#000000',
  accentText: '#FF6D38',

  positive: '#3FD68F',
  negative: '#FF6D38',
  estimate: '#A3BCE0',

  success: '#3FD68F',
  warning: '#FF6D38',
  danger: '#FF7A6B',
};

export const lightColors: ColorRoles = {
  bg: '#E9E7E1',
  surfaceRaised: '#F7F6F2',
  surfaceOverlay: '#FFFFFF',

  text: '#0B0B0B',
  textDim: '#4C4C49',
  textFaint: '#5E5E5A',

  border: '#DAD7CF',
  divider: '#DAD7CF',

  accent: '#FF5A1F',
  onAccent: '#0B0B0B',
  accentText: '#B33A08',

  positive: '#17724E',
  negative: '#B33A08',
  estimate: '#3E5A80',

  success: '#17724E',
  warning: '#B33A08',
  danger: '#B3261E',
};

const darkDepth: Depth = {
  // Tiles sit flat on black; the step in surface carries depth, not a shadow.
  shadowCard: 'none',
  shadowOverlay: '0 12px 32px rgba(0, 0, 0, 0.55)',
  rnElevationCard: 0,
  rnElevationOverlay: 8,
};

const lightDepth: Depth = {
  shadowCard: 'none',
  shadowOverlay: '0 16px 40px rgba(11, 11, 11, 0.18)',
  rnElevationCard: 1,
  rnElevationOverlay: 8,
};

export const darkTheme: Theme = { colors: darkColors, depth: darkDepth };
export const lightTheme: Theme = { colors: lightColors, depth: lightDepth };

/**
 * Type sizes, in px, one rung apart.
 *
 * `hero` is for the one figure a screen exists to show — the month's spend, a
 * person's balance. Everything else steps down from there so the eye is told
 * what matters before it reads a word.
 */
export const typeScale = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 16,
  lg: 20,
  xl: 28,
  hero: 40,
  /** The dot-matrix figure a tile exists to show. */
  display: 56,
  /** The month's spend on the overview: the one number the window leads with. */
  monument: 112,
} as const;

export const weights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** A 4px base. Everything spacing-related is a multiple, so rhythm is automatic. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 18,
  /** Tiles: every grouped surface on both apps. */
  xl: 22,
  pill: 999,
} as const;

/**
 * Note card shades, by colour name, for each theme.
 *
 * Keyed by the same names as the notes' own colour field, which stores a name
 * rather than a value so that each theme can pick a shade that reads on its
 * ground: pale pastels behind dark text in light, deep muted tones behind light
 * text in dark. A test holds this in step with the list of names notes accept.
 */
export const noteShades: Record<ColorScheme, Readonly<Record<string, string>>> = {
  light: {
    red: '#FAAFA8',
    orange: '#F39F76',
    yellow: '#FFF8B8',
    green: '#E2F6D3',
    teal: '#B4DDD3',
    blue: '#D4E4ED',
    purple: '#D3BFDB',
    pink: '#F6E2DD',
    brown: '#E9E3D4',
    grey: '#EFEFF1',
  },
  dark: {
    red: '#77172E',
    orange: '#692B17',
    yellow: '#7C4A03',
    green: '#264D3B',
    teal: '#0C625D',
    blue: '#256377',
    purple: '#472E5B',
    pink: '#6C394F',
    brown: '#4B443A',
    grey: '#2C2E33',
  },
};

/**
 * Vivid fills for category tiles, for any category that has not been given a
 * colour of its own.
 *
 * Muted to sit with the calm palette, but deep enough that a white glyph on
 * each clears 4.4:1. A category is assigned one by its id, so it keeps the same
 * colour everywhere and on both devices.
 */
export const categoryPalette: readonly string[] = [
  '#56689E',
  '#43795C',
  '#9E5B45',
  '#9A7127',
  '#3A6E80',
  '#6F5E9A',
  '#4F7E7A',
  '#7D5F4B',
];

/**
 * Three faces, all SIL OFL and shipped inside the apps (never fetched):
 * Inter Tight for words, JetBrains Mono for labels and small figures, Doto — a
 * dot-matrix face — for the large figures a tile exists to show.
 */
export const fontStacks = {
  ui: '"Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  display: 'Doto, "JetBrains Mono", ui-monospace, monospace',
} as const;

/**
 * Figures render with tabular, lining numerals everywhere.
 *
 * A ledger of amounts only lines up if every digit is the same width; without
 * this, columns of money jitter and the eye cannot scan them.
 */
export const numericFeatures = "'tnum' 1, 'lnum' 1";

export type ColorScheme = 'light' | 'dark';

/**
 * The fill for a category tile.
 *
 * A colour the user chose wins. Otherwise one is derived from the id — not
 * random, and not by position in a list — so a category is the same colour on
 * the phone and the desktop, and stays that colour when others are added.
 */
export function categoryColourFor(categoryId: string, chosen?: string | null): string {
  if (chosen && /^#[0-9a-f]{6}$/i.test(chosen)) return chosen;

  let hash = 0;
  for (let index = 0; index < categoryId.length; index += 1) {
    hash = (hash * 31 + categoryId.charCodeAt(index)) | 0;
  }
  return categoryPalette[Math.abs(hash) % categoryPalette.length]!;
}

/** React Native reports 'unspecified'; anything not explicitly dark renders light. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
