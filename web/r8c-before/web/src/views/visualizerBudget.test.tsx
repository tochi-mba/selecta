import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/**
 * SF-0205-07 and SF-0212-06: the Listen spectrum's render budget. The loop stops while the tab is
 * hidden, draws at most about 15 frames a second, caps the backing store at twice the CSS size and
 * reuses its gradient, so a busy laptop never pays for pictures nobody can see. Real CPU/GPU and
 * power profiles are a person's job; this proves the code keeps to the budget.
 */

const mix: MixItem[] = [{ position: 0, song_id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', locked: false, seam: null }];

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let gradients: number;
let hidden: boolean;

function fakeContext() {
  const gradient = { addColorStop: () => {} };
  return new Proxy({}, {
    get: (_target, key) => {
      if (key === 'createLinearGradient') return () => { gradients += 1; return gradient; };
      return () => {};
    },
    set: () => true,
  });
}

/** Runs every waiting frame once at `time`, returning how many there were. */
function runFrames(time: number) {
  const waiting = [...frames.values()];
  frames.clear();
  act(() => { for (const callback of waiting) callback(time); });
  return waiting.length;
}

function view(player: SetPlayer) {
  return (
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
      setView={() => {}} notify={() => {}} stage toggleStage={() => {}} />
  );
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  gradients = 0;
  hidden = false;
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 50 } as DOMRect);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('devicePixelRatio', 4);
  fakeBackend({ 'GET /songs/1': { id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', peaks: [], bar_times: [], beat_times: [], beats_per_bar: 4, sections: [], lines: [] } });
});

afterEach(() => vi.restoreAllMocks());

function playing() {
  const player = new SetPlayer(() => mix, () => {});
  const spectrum = vi.spyOn(player, 'getSpectrum').mockReturnValue(new Uint8Array(64).fill(128));
  return { player, spectrum };
}

describe('SF-0205-07 / SF-0212-06 the spectrum keeps to its render budget', () => {
  it('draws at most about 15 frames a second however fast the display refreshes', () => {
    const { player, spectrum } = playing();
    render(view(player));
    expect(document.querySelector('canvas.music-visualizer')).not.toBeNull();
    spectrum.mockClear();
    // one second of a 60 Hz display
    for (let time = 1000; time <= 2000; time += 1000 / 60) runFrames(time);
    expect(spectrum.mock.calls.length).toBeGreaterThan(10);
    expect(spectrum.mock.calls.length).toBeLessThanOrEqual(16);
  });

  it('stops its loop while the tab is hidden and starts again when it comes back', () => {
    const { player, spectrum } = playing();
    render(view(player));
    expect(frames.size).toBe(1);
    hidden = true;
    expect(runFrames(1000)).toBe(1);
    // nothing scheduled, nothing measured while nobody can see it
    expect(frames.size).toBe(0);
    spectrum.mockClear();
    for (let time = 1100; time < 3000; time += 100) runFrames(time);
    expect(spectrum).not.toHaveBeenCalled();
    hidden = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spectrum).toHaveBeenCalled();
    expect(frames.size).toBe(1);
  });

  it('caps the backing store at twice the CSS size and reuses one gradient', () => {
    const { player } = playing();
    render(view(player));
    for (let time = 1000; time <= 3000; time += 100) runFrames(time);
    const canvas = document.querySelector('canvas.music-visualizer') as HTMLCanvasElement;
    // devicePixelRatio is 4, but the canvas never allocates more than 2x
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(gradients).toBe(1);
  });

  it('cancels its frame when Listen goes away', () => {
    const { player } = playing();
    const rendered = render(view(player));
    expect(frames.size).toBe(1);
    rendered.unmount();
    expect(frames.size).toBe(0);
  });
});
