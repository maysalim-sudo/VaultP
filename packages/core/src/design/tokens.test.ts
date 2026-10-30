import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type ColorRoles } from './tokens.js';

/**
 * Every colour that carries words has to be readable where it is printed.
 *
 * The industrial palette leans on contrast — ink on paper, light on black — but
 * its one accent is a bright orange that is easy to put somewhere it cannot be
 * read. These are the pairings the screens actually use, held to WCAG AA.
 */

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT_ROLES = [
  'text',
  'textDim',
  'textFaint',
  'accentText',
  'positive',
  'negative',
  'estimate',
  'danger',
] as const satisfies readonly (keyof ColorRoles)[];

const GROUNDS = ['bg', 'surfaceRaised', 'surfaceOverlay'] as const satisfies readonly (keyof ColorRoles)[];

describe.each([
  ['dark', darkColors],
  ['light', lightColors],
] as const)('the %s palette', (_name, colors) => {
  it.each(TEXT_ROLES.flatMap((role) => GROUNDS.map((ground) => [role, ground] as const)))(
    '%s reads on %s (AA, 4.5:1)',
    (role, ground) => {
      expect(contrast(colors[role], colors[ground])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('prints readable text on the orange', () => {
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('inverts cleanly for ink buttons (ground on text)', () => {
    expect(contrast(colors.bg, colors.text)).toBeGreaterThanOrEqual(7);
  });
});
