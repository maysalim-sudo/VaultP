import { describe, expect, it } from 'vitest';

import { evaluate } from './firewall.js';

describe('whether Windows would let the phone in', () => {
  it('is blocked on a public network with no rule — the usual home Wi-Fi', () => {
    expect(evaluate({ categories: ['Public'], rules: [] })).toBe('blocked');
  });

  it('is blocked when the only allow rule is for private networks', () => {
    expect(
      evaluate({ categories: ['Public', 'Private'], rules: [{ action: 'Allow', profile: 'Private' }] }),
    ).toBe('blocked');
  });

  it('is allowed by a rule for any profile', () => {
    expect(evaluate({ categories: ['Public', 'Private'], rules: [{ action: 'Allow', profile: 'Any' }] })).toBe(
      'allowed',
    );
  });

  it('reads combined profiles and domain networks', () => {
    expect(
      evaluate({
        categories: ['DomainAuthenticated', 'Public'],
        rules: [{ action: 'Allow', profile: 'Domain, Public' }],
      }),
    ).toBe('allowed');
  });

  it('lets a block rule win, as Windows does', () => {
    expect(
      evaluate({
        categories: ['Private'],
        rules: [
          { action: 'Allow', profile: 'Any' },
          { action: 'Block', profile: 'Private' },
        ],
      }),
    ).toBe('blocked');
  });

  it('does not guess when Windows reported no networks', () => {
    expect(evaluate({ categories: [], rules: [] })).toBe('unknown');
  });
});
