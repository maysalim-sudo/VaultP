import { describe, expect, it } from 'vitest';
import { timestampOf, uuidv7 } from '../id.js';
import {
  ClockDriftError,
  HybridClock,
  compareHlc,
  decodeHlc,
  encodeHlc,
} from './hlc.js';

function fixedClock(start: number) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}

describe('HybridClock', () => {
  it('advances with the wall clock', () => {
    const time = fixedClock(1_000_000);
    const clock = new HybridClock({ device: 'dev_a', now: time.now });

    const first = clock.tick();
    time.advance(50);
    const second = clock.tick();

    expect(second.wallMs).toBe(first.wallMs + 50);
    expect(second.counter).toBe(0);
  });

  it('uses the counter when several writes land in one millisecond', () => {
    const time = fixedClock(1_000_000);
    const clock = new HybridClock({ device: 'dev_a', now: time.now });

    const stamps = [clock.tick(), clock.tick(), clock.tick()];

    expect(stamps.map((s) => s.counter)).toEqual([0, 1, 2]);
    expect(compareHlc(stamps[0]!, stamps[1]!)).toBe(-1);
    expect(compareHlc(stamps[1]!, stamps[2]!)).toBe(-1);
  });

  it('never goes backwards when the system clock does', () => {
    const time = fixedClock(1_000_000);
    const clock = new HybridClock({ device: 'dev_a', now: time.now });

    const before = clock.tick();
    time.set(900_000); // user changed the time, or a timezone/NTP correction
    const after = clock.tick();

    expect(compareHlc(before, after)).toBe(-1);
    expect(after.wallMs).toBe(before.wallMs);
  });

  it('orders a received event before the local write that follows it', () => {
    const time = fixedClock(1_000_000);
    const local = new HybridClock({ device: 'dev_local', now: time.now });

    // Remote wrote 5 seconds "in the future" relative to us.
    const remote = { wallMs: 1_005_000, counter: 0, device: 'dev_remote' };
    const merged = local.receive(remote);
    const next = local.tick();

    expect(compareHlc(remote, merged)).toBe(-1);
    expect(compareHlc(merged, next)).toBe(-1);
  });

  it('rejects a remote clock beyond the drift limit', () => {
    const time = fixedClock(1_000_000);
    const clock = new HybridClock({ device: 'dev_a', now: time.now });
    const wayAhead = { wallMs: 1_000_000 + 3 * 60 * 60 * 1000, counter: 0, device: 'dev_b' };

    expect(() => clock.receive(wayAhead)).toThrow(ClockDriftError);
  });

  it('breaks exact ties by device id, identically on both devices', () => {
    const a = { wallMs: 5, counter: 1, device: 'dev_aaa' };
    const b = { wallMs: 5, counter: 1, device: 'dev_bbb' };
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
  });
});

describe('HLC encoding', () => {
  it('round-trips', () => {
    const hlc = { wallMs: 1_700_000_000_000, counter: 42, device: 'dev_a1b2c3' };
    expect(decodeHlc(encodeHlc(hlc))).toEqual(hlc);
  });

  it('sorts lexicographically in the same order it compares', () => {
    const stamps = [
      { wallMs: 2, counter: 0, device: 'dev_a' },
      { wallMs: 10, counter: 0, device: 'dev_a' },
      { wallMs: 10, counter: 1, device: 'dev_a' },
      { wallMs: 10, counter: 1, device: 'dev_b' },
      { wallMs: 100, counter: 0, device: 'dev_a' },
    ];

    const byCompare = [...stamps].sort(compareHlc).map(encodeHlc);
    const byString = [...stamps].map(encodeHlc).sort();

    // This equivalence is what lets SQLite ORDER BY replay events correctly.
    expect(byString).toEqual(byCompare);
  });

  it('rejects malformed input', () => {
    expect(() => decodeHlc('nonsense')).toThrow(/Malformed/);
    expect(() => decodeHlc('1|2')).toThrow(/Malformed/);
  });
});

describe('uuidv7', () => {
  it('is unique across many rapid calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });

  it('sorts in creation order even within one millisecond', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7(1_700_000_000_000));
    expect([...ids].sort()).toEqual(ids);
  });

  it('embeds a recoverable timestamp', () => {
    const before = Date.now();
    const embedded = timestampOf(uuidv7());
    expect(embedded).toBeGreaterThanOrEqual(before);
    expect(embedded).toBeLessThan(before + 5_000);
  });

  it('clamps a timestamp in the past rather than sorting behind an issued id', () => {
    // Monotonicity outranks honouring the argument: an id that sorted before one
    // already handed out would corrupt event ordering.
    const recent = timestampOf(uuidv7());
    const backdated = timestampOf(uuidv7(1_000_000_000_000));
    expect(backdated).toBeGreaterThanOrEqual(recent);
  });

  it('is well-formed with version 7 and the RFC variant', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
