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
 * WHY THE ACCENT IS COOL, NOT GOLD. A gold accent suits a vault and reads warm,
 * but the app now has a light theme as well as a dark one, and a colour used as
 * a button background has to stay legible under its own text in both. Gold
 * cannot: light enough to sit under dark text on a dark screen, it is far too
 * pale to sit under white on a light one. An indigo darkens and lightens
 * cleanly, so it carries both themes. Warmth, if it is wanted, can return
 * through a Stitch palette aimed at a dark-first product.
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

  readonly accent: string;
  /** Text/icons printed on top of the accent. */
  readonly onAccent: string;

  // The money meanings, named rather than signed — "-200" reads as either the
  // moment attention lapses.
  /** Owed to you; money coming back. */
  readonly positive: string;
  /** You owe; overspent. */
  readonly negative: string;
  /**
   * The `≈` state: a value derived from a past rate, not a fact and not an
   * error. Cool on purpose, so it reads as provisional against the accent.
   */
  readonly estimate: string;

  readonly success: string;
  readonly warning: string;
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
  bg: '#0E1013',
  surfaceRaised: '#16191F',
  surfaceOverlay: '#1E222A',

  text: '#F2F4F7',
  textDim: '#9AA3AF',
  textFaint: '#6B7280',

  border: '#2A2F38',
  divider: '#20242B',

  accent: '#7C93FF',
  onAccent: '#0B1020',

  positive: '#4ADE80',
  negative: '#F87171',
  estimate: '#8AA0C0',

  success: '#4ADE80',
  warning: '#FB923C',
  danger: '#F87171',
};

export const lightColors: ColorRoles = {
  bg: '#F6F7F9',
  surfaceRaised: '#FFFFFF',
  surfaceOverlay: '#FFFFFF',

  text: '#14181D',
  textDim: '#5C6672',
  textFaint: '#8A929C',

  border: '#E4E7EC',
  divider: '#EEF1F4',

  accent: '#4457D6',
  onAccent: '#FFFFFF',

  positive: '#1E9E57',
  negative: '#D64545',
  estimate: '#5E7290',

  success: '#1E9E57',
  warning: '#C2620E',
  danger: '#D64545',
};

const darkDepth: Depth = {
  // A faint lift only; on dark, the surface step above does most of the work.
  shadowCard: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadowOverlay: '0 12px 32px rgba(0, 0, 0, 0.55)',
  rnElevationCard: 0,
  rnElevationOverlay: 8,
};

const lightDepth: Depth = {
  shadowCard: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.10)',
  shadowOverlay: '0 12px 32px rgba(16, 24, 40, 0.18)',
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
  md: 12,
  lg: 16,
  /** The generous, friendly rounding of the money screens. */
  xl: 24,
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
 * Deep enough to carry a white glyph in either theme. A category is assigned one
 * by its id, so it keeps the same colour everywhere and on both devices.
 */
export const categoryPalette: readonly string[] = [
  '#5C3DF5',
  '#12A876',
  '#E5384F',
  '#E8672A',
  '#2F7BEA',
  '#B43DDB',
  '#0E9494',
  '#8A5A44',
];

export const fontStacks = {
  ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
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
