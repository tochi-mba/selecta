import { describe, expect, it } from 'vitest';
import { OfflineClock, clockSuspect, kioskNow, wallClockPlausible, type ClockSource } from './offlineClock';

const NOW = 1_800_000_000;

function fakeSource(wall: number) {
  const t = { mono: 100, wall };
  const source: ClockSource = { monotonic: () => t.mono, wall: () => t.wall };
  return { t, source };
}

describe('kioskNow', () => {
  it('adds monotonic elapsed to the last server time', () => {
    expect(kioskNow(NOW, 10, 610)).toBe(NOW + 600);
  });
  it('never goes backwards when monotonic resets', () => {
    expect(kioskNow(NOW, 10, 5)).toBe(NOW);
  });
  it('flags drift over 120 s and checks plausibility', () => {
    expect(clockSuspect(NOW + 121, NOW)).toBe(true);
    expect(clockSuspect(NOW - 60, NOW)).toBe(false);
    expect(wallClockPlausible(NOW, NOW - 1, NOW + 1)).toBe(true);
    expect(wallClockPlausible(NOW + 5, NOW - 1, NOW + 1)).toBe(false);
  });
});

describe('OfflineClock', () => {
  it('uses server time, not a wall clock six hours wrong', () => {
    const { t, source } = fakeSource(NOW + 6 * 3600);
    const clock = new OfflineClock(source);
    clock.sync(NOW);
    t.mono += 1800;
    t.wall += 1800;
    expect(clock.now()).toBe(NOW + 1800);
    expect(clock.status()).toBe('trusted');
    expect(clock.clockSuspect()).toBe(true);
    expect(clock.driftS()).toBe(6 * 3600);
  });

  it('smooths the offset as a median of the last 10 samples', () => {
    const { t, source } = fakeSource(NOW);
    const clock = new OfflineClock(source);
    for (let i = 0; i < 12; i += 1) {
      clock.sync(t.wall + (i === 11 ? 500 : 2));
      t.wall += 1;
      t.mono += 1;
    }
    expect(clock.offsetS()).toBe(2);
    expect(new OfflineClock(source).offsetS()).toBe(0);
  });

  it('is not suspect within two minutes', () => {
    const { source } = fakeSource(NOW + 30);
    const clock = new OfflineClock(source);
    clock.sync(NOW);
    expect(clock.clockSuspect()).toBe(false);
  });

  it('after a reboot uses a plausible wall clock, else time is unknown', () => {
    const { t, source } = fakeSource(NOW);
    const clock = new OfflineClock(source);
    expect(clock.status()).toBe('untrusted');
    expect(clock.now()).toBeNull();
    expect(clock.driftS()).toBeNull();
    clock.setBundle(NOW - 3600, NOW + 7 * 86400);
    expect(clock.status()).toBe('wall_plausible');
    expect(clock.now()).toBe(NOW);
    t.wall = NOW - 2 * 86400;
    expect(clock.status()).toBe('untrusted');
    expect(clock.now()).toBeNull();
  });
});
