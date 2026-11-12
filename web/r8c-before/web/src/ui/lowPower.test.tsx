import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { prefs, reloadPrefs, setPrefs } from '../state/prefs';
import { keepFullMotion, lowPowerActive, resetLowPower, REST_MS, SLOW_FRAME_MS, struggling, watchLowPower, WINDOW_FRAMES } from './lowPower';
import { useReducedMotion } from './useReducedMotion';

/** A hand-cranked frame clock: each `run(n, gap)` delivers n frames `gap` ms apart. */
function fakeClock() {
  let pending: ((time: number) => void) | null = null;
  let timer: (() => void) | null = null;
  let now = 0;
  let hidden = false;
  return {
    clock: {
      frame: (callback: (time: number) => void) => {
        pending = callback;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
      hidden: () => hidden,
      later: (callback: () => void) => {
        timer = callback;
        return 2;
      },
      clear: () => {
        timer = null;
      },
    },
    run(frames: number, gap: number) {
      for (let i = 0; i < frames && pending; i++) {
        const next = pending;
        pending = null;
        now += gap;
        act(() => next(now));
      }
    },
    waiting: () => pending !== null,
    resting: () => timer !== null,
    wake() {
      const next = timer;
      timer = null;
      next?.();
    },
    hide(value: boolean) {
      hidden = value;
    },
  };
}

function Probe() {
  return <span>{useReducedMotion() ? 'Still' : 'Animated'}</span>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reloadPrefs();
  resetLowPower();
  setFlags(null);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLowPower();
});

describe('SF-0235-08 automatic low-power motion', () => {
  it('only calls a window struggling when most real frames are slow', () => {
    expect(struggling(Array(WINDOW_FRAMES).fill(16))).toBe(false);
    expect(struggling(Array(WINDOW_FRAMES).fill(SLOW_FRAME_MS + 20))).toBe(true);
    // a hidden tab's long gaps are not slow frames
    expect(struggling(Array(WINDOW_FRAMES).fill(5000))).toBe(false);
    // one hitch among smooth frames is fine
    expect(struggling([...Array(WINDOW_FRAMES - 5).fill(16), ...Array(5).fill(200)])).toBe(false);
  });

  it('lowers motion after two struggling windows in a row, and keeps information on screen', () => {
    const fake = fakeClock();
    render(<Probe />);
    watchLowPower(fake.clock);
    fake.run(WINDOW_FRAMES + 1, 80);
    expect(lowPowerActive()).toBe(false);
    fake.run(WINDOW_FRAMES, 80);
    expect(lowPowerActive()).toBe(true);
    expect(document.documentElement.dataset.lowPower).toBe('auto');
    expect(screen.getByText('Still')).toBeInTheDocument();
    // the saved choice is untouched: this is a lowering for this visit, not a new preference
    expect(prefs().motion).toBe('subtle');
    // and the sampler stops once it has decided
    expect(fake.waiting()).toBe(false);
  });

  it('leaves a healthy device alone and rests between short samples', () => {
    const fake = fakeClock();
    watchLowPower(fake.clock);
    fake.run(WINDOW_FRAMES * 5, 16);
    expect(lowPowerActive()).toBe(false);
    expect(fake.waiting()).toBe(false);
    expect(fake.resting()).toBe(true);
    expect(REST_MS).toBeGreaterThanOrEqual(30_000);
    fake.wake();
    expect(fake.waiting()).toBe(true);
  });

  it('does not count frames while the page is hidden, or when Still is already chosen, or with its flag off', () => {
    const hidden = fakeClock();
    hidden.hide(true);
    watchLowPower(hidden.clock);
    hidden.run(WINDOW_FRAMES * 3, 80);
    expect(lowPowerActive()).toBe(false);

    resetLowPower();
    setPrefs({ motion: 'still' });
    const still = fakeClock();
    watchLowPower(still.clock);
    still.run(WINDOW_FRAMES * 3, 80);
    expect(lowPowerActive()).toBe(false);

    resetLowPower();
    setPrefs({ motion: 'subtle' });
    setFlags({ 'app.auto_low_motion': false });
    const off = fakeClock();
    watchLowPower(off.clock);
    off.run(WINDOW_FRAMES * 3, 80);
    expect(lowPowerActive()).toBe(false);
  });

  it('gives full motion back on request, for the rest of the session', () => {
    const fake = fakeClock();
    render(<Probe />);
    watchLowPower(fake.clock);
    fake.run(WINDOW_FRAMES * 2 + 1, 80);
    expect(screen.getByText('Still')).toBeInTheDocument();
    act(() => keepFullMotion());
    expect(screen.getByText('Animated')).toBeInTheDocument();
    expect(document.documentElement.dataset.lowPower).toBeUndefined();
    const again = fakeClock();
    watchLowPower(again.clock);
    again.run(WINDOW_FRAMES * 3, 80);
    expect(lowPowerActive()).toBe(false);
  });
});
