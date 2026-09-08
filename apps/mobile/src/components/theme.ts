/**
 * Colours, in one place.
 *
 * Two palettes rather than a theming library: the app has a handful of surfaces,
 * and the phone's own light/dark setting is the only input. Anything more would be
 * machinery in search of a use.
 */

export interface Palette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly dim: string;
  readonly key: string;
  readonly ripple: string;
  readonly border: string;
  readonly divider: string;
  readonly accent: string;
  readonly danger: string;
  readonly success: string;
  readonly warning: string;
}

export const lightPalette: Palette = {
  background: '#FFFFFF',
  surface: '#F8F9FA',
  text: '#111417',
  dim: '#868E96',
  key: '#F1F3F5',
  ripple: '#DEE2E6',
  border: '#DEE2E6',
  divider: '#F1F3F5',
  accent: '#1971C2',
  danger: '#C92A2A',
  success: '#2F9E44',
  warning: '#E8590C',
};

export const darkPalette: Palette = {
  background: '#121417',
  surface: '#1A1D21',
  text: '#F8F9FA',
  dim: '#868E96',
  key: '#1E2126',
  ripple: '#343A40',
  border: '#343A40',
  divider: '#25292E',
  accent: '#4DABF7',
  danger: '#FF6B6B',
  success: '#51CF66',
  warning: '#FF922B',
};

/**
 * React Native reports 'unspecified' as well as light/dark, so the parameter is
 * widened rather than narrowed at each call site. Anything that is not explicitly
 * dark renders light.
 */
export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? darkPalette : lightPalette;
}
