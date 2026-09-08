/**
 * Hybrid logical clock.
 *
 * The problem: two devices edit offline and later merge. Wall-clock timestamps
 * alone are unsafe — the desktop may sit switched off for weeks, phone clocks
 * drift, and a user can change the time by hand. If ordering came from the wall
 * clock, a device whose clock is slow would have all its edits silently lose.
 *
 * An HLC is (physical time, logical counter, device id). It tracks wall time
 * closely enough to stay human-meaningful, but the counter guarantees that a
 * write which *observed* another write always sorts after it, regardless of what
 * the clocks say. The device id breaks exact ties, giving a total order that both
 * devices compute identically without talking to each other.
 */

const WALL_DIGITS = 15; // ms since epoch, zero-padded; good past the year 33000
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

/**
 * Reject a remote timestamp more than this far ahead of local wall time. Without
 * it, one device with a badly wrong clock would drag the shared clock into the
 * future permanently, and every later local edit would lose every merge.
 */
export const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;

export interface Hlc {
  readonly wallMs: number;
  readonly counter: number;
  readonly device: string;
}

export class ClockDriftError extends Error {
  constructor(remoteWallMs: number, localWallMs: number) {
    const aheadMinutes = Math.round((remoteWallMs - localWallMs) / 60000);
    super(
      `Remote clock is ${aheadMinutes} minutes ahead of local time, beyond the ` +
        `permitted drift. Refusing to adopt it; check the clock on both devices.`,
    );
    this.name = 'ClockDriftError';
  }
}

export class CounterOverflowError extends Error {
  constructor() {
    super('Hybrid logical clock counter overflowed within a single millisecond.');
    this.name = 'CounterOverflowError';
  }
}

/**
 * Encode to a string that sorts lexicographically in exactly the same order as
 * the clock compares. This matters: it lets SQLite ORDER BY and a plain string
 * sort replay events correctly with no custom comparator.
 */
export function encodeHlc(hlc: Hlc): string {
  return [
    String(hlc.wallMs).padStart(WALL_DIGITS, '0'),
    String(hlc.counter).padStart(COUNTER_DIGITS, '0'),
    hlc.device,
  ].join('|');
}

export function decodeHlc(encoded: string): Hlc {
  const parts = encoded.split('|');
  if (parts.length !== 3) throw new Error(`Malformed HLC: "${encoded}"`);
  const [wall, counter, device] = parts as [string, string, string];
  const wallMs = Number(wall);
  const counterValue = Number(counter);
  if (!Number.isInteger(wallMs) || !Number.isInteger(counterValue) || device === '') {
    throw new Error(`Malformed HLC: "${encoded}"`);
  }
  return { wallMs, counter: counterValue, device };
}

/** Total order. Encoded HLCs compare identically with plain string comparison. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.device === b.device) return 0;
  return a.device < b.device ? -1 : 1;
}

export interface ClockOptions {
  readonly device: string;
  /** Injectable for tests and for platforms with a monotonic time source. */
  readonly now?: () => number;
  readonly maxDriftMs?: number;
}

/**
 * The device's clock. One instance per process, persisted across restarts by
 * saving `state` so the counter is not reset while the wall clock is unchanged.
 */
export class HybridClock {
  private wallMs: number;
  private counter: number;
  private readonly device: string;
  private readonly now: () => number;
  private readonly maxDriftMs: number;

  constructor(options: ClockOptions, state?: Hlc) {
    this.device = options.device;
    this.now = options.now ?? (() => Date.now());
    this.maxDriftMs = options.maxDriftMs ?? MAX_CLOCK_DRIFT_MS;
    this.wallMs = state?.wallMs ?? 0;
    this.counter = state?.counter ?? 0;
  }

  /** Current state, to persist between sessions. */
  get state(): Hlc {
    return { wallMs: this.wallMs, counter: this.counter, device: this.device };
  }

  /** Stamp a local write. Always strictly greater than any timestamp issued before. */
  tick(): Hlc {
    const physical = this.now();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      // Clock went backwards or has not advanced: rely on the counter so that
      // ordering never regresses.
      this.counter += 1;
      if (this.counter > MAX_COUNTER) throw new CounterOverflowError();
    }
    return this.state;
  }

  /**
   * Fold in a timestamp seen on an incoming event, then stamp. Guarantees the
   * returned timestamp is greater than both our previous state and the remote
   * one, which is what makes causality hold across devices.
   */
  receive(remote: Hlc): Hlc {
    const physical = this.now();

    if (remote.wallMs - physical > this.maxDriftMs) {
      throw new ClockDriftError(remote.wallMs, physical);
    }

    const previousWall = this.wallMs;
    const wall = Math.max(previousWall, remote.wallMs, physical);

    if (wall === previousWall && wall === remote.wallMs) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (wall === previousWall) {
      this.counter += 1;
    } else if (wall === remote.wallMs) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }

    if (this.counter > MAX_COUNTER) throw new CounterOverflowError();
    this.wallMs = wall;
    return this.state;
  }
}
