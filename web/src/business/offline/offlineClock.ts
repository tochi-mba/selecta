// Trusted time for a kiosk (ADR-0446 "Clocks"). Mirrors `kiosk_now` in
// src/selecta/business/offline.py: schedule decisions use the last server time plus monotonic
// elapsed time, never the device wall clock, so a kiosk whose clock is hours wrong still opens
// and closes on time. All times here are epoch seconds.

export const CLOCK_SUSPECT_S = 120;
export const OFFSET_SAMPLES = 10;

/** Last server time plus monotonic seconds elapsed since that sync (never negative). */
export function kioskNow(lastServerTime: number, monotonicAtSync: number, monotonicNow: number): number {
  return lastServerTime + Math.max(0, monotonicNow - monotonicAtSync);
}

/** Drift over 2 minutes is a device fault shown to the manager; playback is unaffected. */
export function clockSuspect(deviceWall: number, trustedNow: number): boolean {
  return Math.abs(deviceWall - trustedNow) > CLOCK_SUSPECT_S;
}

/** After a reboot with no contact, the wall clock is used only inside the bundle's life. */
export function wallClockPlausible(deviceWall: number, bundleIssuedAt: number, validUntil: number): boolean {
  return deviceWall >= bundleIssuedAt && deviceWall <= validUntil;
}

export type ClockSource = {
  /** Monotonic seconds (performance.now() / 1000 in the browser). */
  monotonic: () => number;
  /** Device wall clock in epoch seconds. */
  wall: () => number;
};

export const browserClockSource: ClockSource = {
  monotonic: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  wall: () => Date.now() / 1000,
};

export type ClockStatus = 'trusted' | 'wall_plausible' | 'untrusted';

export class OfflineClock {
  private lastServerTime: number | null = null;
  private monotonicAtSync = 0;
  private offsets: number[] = [];
  private bundle: { issuedAt: number; validUntil: number } | null = null;

  constructor(private readonly source: ClockSource = browserClockSource) {}

  /** Record `server_time` from an answer; keeps the last 10 offsets for a smoothed drift. */
  sync(serverTime: number): void {
    this.lastServerTime = serverTime;
    this.monotonicAtSync = this.source.monotonic();
    this.offsets.push(serverTime - this.source.wall());
    if (this.offsets.length > OFFSET_SAMPLES) this.offsets.shift();
  }

  /** The offline bundle's issue time and the permit's `valid_until`, for the reboot rule. */
  setBundle(issuedAt: number, validUntil: number): void {
    this.bundle = { issuedAt, validUntil };
  }

  /** Server minus device wall clock, the median of the last samples (0 before any sync). */
  offsetS(): number {
    if (!this.offsets.length) return 0;
    const sorted = [...this.offsets].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  status(): ClockStatus {
    if (this.lastServerTime !== null) return 'trusted';
    const b = this.bundle;
    if (b && wallClockPlausible(this.source.wall(), b.issuedAt, b.validUntil)) return 'wall_plausible';
    return 'untrusted';
  }

  /** Trusted now, a plausible wall clock after a reboot, or null when time is unknown. */
  now(): number | null {
    if (this.lastServerTime !== null) {
      return kioskNow(this.lastServerTime, this.monotonicAtSync, this.source.monotonic());
    }
    return this.status() === 'wall_plausible' ? this.source.wall() : null;
  }

  /** Device wall clock minus trusted time, or null when not synced. */
  driftS(): number | null {
    if (this.lastServerTime === null) return null;
    const trusted = this.now();
    return trusted === null ? null : this.source.wall() - trusted;
  }

  clockSuspect(): boolean {
    const drift = this.driftS();
    return drift !== null && Math.abs(drift) > CLOCK_SUSPECT_S;
  }
}
