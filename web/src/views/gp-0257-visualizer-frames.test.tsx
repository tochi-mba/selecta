import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, setPrefs } from '../state/prefs';
import { MusicVisualizer } from './Now';

/** GP-0257-05: how much drawing the visualizer asks for. Hidden or Still costs no frames at all, and
 * playing is held to about 15 drawn frames a second however fast the screen refreshes. */

let queued: FrameRequestCallback[] = [];
let drawn = 0;
let resize: (() => void) | null = null;
const player = { getSpectrum: () => new Uint8Array(64).fill(120) } as never;

function pump(frames: number, step = 1000 / 60) {
  for (let n = 1; n <= frames; n += 1) {
    const due = queued;
    queued = [];
    for (const callback of due) callback(n * step);
  }
}

beforeEach(() => {
  queued = [];
  drawn = 0;
  resize = null;
  const context = new Proxy({}, {
    get: (_target, name) => {
      if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (name === 'clearRect') return () => { drawn += 1; };
      return () => {};
    },
  });
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    queued.push(callback);
    return queued.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as never); }
    observe() {}
    disconnect() {}
    unobserve() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPrefs(DEFAULT_PREFS);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const show = () => render(<MusicVisualizer player={player} active stage={false} intensity="standard" spectrumShape="bars" />);

describe('GP-0257-05 the visualizer only spends frames when someone can see it moving', () => {
  it('asks for no frames at all under Still, after drawing once', () => {
    setPrefs({ ...DEFAULT_PREFS, motion: 'still' });
    show();
    pump(120);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(drawn).toBe(1);
  });

  it('does not sample a new analyser frame when a still canvas is woken again', () => {
    setPrefs({ ...DEFAULT_PREFS, motion: 'still' });
    show();
    expect(drawn).toBe(1);
    resize?.();
    resize?.();
    expect(drawn).toBe(1);
  });

  it('asks for no frames and draws nothing while the tab is hidden', () => {
    setPrefs({ ...DEFAULT_PREFS, motion: 'expressive' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    show();
    pump(120);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(drawn).toBe(0);
  });

  it('draws about 15 frames a second while playing on a 60 Hz screen, not 60', () => {
    setPrefs({ ...DEFAULT_PREFS, motion: 'expressive' });
    show();
    const first = drawn;
    pump(60);
    const perSecond = drawn - first;
    expect(perSecond).toBeGreaterThanOrEqual(12);
    expect(perSecond).toBeLessThanOrEqual(16);
  });
});

describe('SF-0212-07 a still visualizer never holds the silent first frame', () => {
  it('looks again until there is sound, then holds that one frame without asking for animation frames', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setPrefs({ ...DEFAULT_PREFS, motion: 'still' });
      let level = 0;
      const quietThenLoud = { getSpectrum: () => new Uint8Array(64).fill(level) } as never;
      render(<MusicVisualizer player={quietThenLoud} active stage={false} intensity="standard" spectrumShape="bars" />);
      expect(drawn).toBe(1);
      vi.advanceTimersByTime(250);
      expect(drawn).toBe(2);
      level = 120;
      vi.advanceTimersByTime(250);
      expect(drawn).toBe(3);
      vi.advanceTimersByTime(5000);
      expect(drawn).toBe(3);
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after a few seconds of silence rather than polling for ever', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setPrefs({ ...DEFAULT_PREFS, motion: 'still' });
      const silent = { getSpectrum: () => new Uint8Array(64) } as never;
      render(<MusicVisualizer player={silent} active stage={false} intensity="standard" spectrumShape="bars" />);
      vi.advanceTimersByTime(60_000);
      expect(drawn).toBe(41);
    } finally {
      vi.useRealTimers();
    }
  });
});
