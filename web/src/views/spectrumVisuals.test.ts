import { describe, expect, it, vi } from 'vitest';
import {
  frequencyLevels, MAX_SPECTRUM_HISTORY, MAX_TRAIL_HISTORY, paintFrequencyFrame,
  SPECTRUM_MODES, spectrumLevelCount, type SpectrumShape,
} from './spectrumVisuals';

function fakeContext() {
  const names = ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath',
    'fill', 'stroke', 'fillRect', 'arc'];
  const fns = Object.fromEntries(names.map((name) => [name, vi.fn()]));
  return { ...fns, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: 'butt' } as unknown as CanvasRenderingContext2D;
}
const colours = { accent: '#d5f36b', soft: '#ffffff', gradient: '#d5f36b' };
const get = (context: CanvasRenderingContext2D, name: 'fill' | 'stroke' | 'fillRect' | 'arc') =>
  vi.mocked(context[name]).mock.calls.length;

describe('fifteen width-first real-audio visualizations', () => {
  it('declares all nine new alternatives with unique names and a single public menu', () => {
    expect(SPECTRUM_MODES.map((mode) => mode.id)).toEqual([
      'bars', 'ribbon', 'aurora', 'lanes', 'constellation', 'waterfall',
      'skyline', 'threads', 'pins', 'matrix', 'trails',
      'dunes', 'candles', 'mesh', 'split',
    ]);
    expect(new Set(SPECTRUM_MODES.map((mode) => mode.label)).size).toBe(15);
    expect(SPECTRUM_MODES.every((mode) => mode.description.length > 12)).toBe(true);
  });

  it('groups only actual nonzero bins, keeps silence at zero and refuses absent signal', () => {
    expect(frequencyLevels(new Uint8Array(), 12)).toEqual([]);
    expect(frequencyLevels(new Uint8Array(24), 12)).toEqual(Array(12).fill(0));
    expect(frequencyLevels(Uint8Array.from([0, 0, 128, 255]), 4).some((value) => value === 1)).toBe(true);
    expect(frequencyLevels(Uint8Array.from([0, 0, 128, 255]), 4).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(spectrumLevelCount(1080, 1, 'aurora')).toBeGreaterThan(spectrumLevelCount(200, 2, 'aurora'));
    expect(spectrumLevelCount(100000, 1, 'aurora')).toBe(128);
  });

  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s never draws from missing or silent samples', (mode) => {
      const context = fakeContext();
      const history: number[][] = [];
      expect(paintFrequencyFrame(context, 800, 120, [], mode, colours, history)).toBe(false);
      expect(paintFrequencyFrame(context, 800, 120, [0, 0, 0], mode, colours, history)).toBe(false);
      expect(get(context, 'fill') + get(context, 'fillRect') + get(context, 'arc')).toBe(0);
    },
  );

  it('draws a long, continuous three-layer aurora only from sampled frequency levels', () => {
    const context = fakeContext();
    paintFrequencyFrame(context, 900, 130, [0.2, 0.8, 0.4, 0.6], 'aurora', colours, []);
    expect(get(context, 'fill')).toBe(3);
    expect(get(context, 'stroke')).toBe(3);
    expect(vi.mocked(context.lineTo).mock.calls.some((args) => args[0] === 900)).toBe(true);
    expect(context.globalAlpha).toBe(1);
  });

  it('draws four separate spectral lanes in the full horizontal extent', () => {
    const context = fakeContext();
    paintFrequencyFrame(context, 1000, 120, Array(64).fill(0.5), 'lanes', colours, []);
    expect(get(context, 'fillRect')).toBe(8);
    expect(vi.mocked(context.fillRect).mock.calls.some((args) => args[2] === 1000)).toBe(true);
  });

  it('draws measured connected points without random positions or motion', () => {
    const context = fakeContext();
    paintFrequencyFrame(context, 800, 110, [0, 0.2, 0.5, 1], 'constellation', colours, []);
    expect(get(context, 'arc')).toBe(3);
    expect(get(context, 'stroke')).toBe(1);
    expect(vi.mocked(context.arc).mock.calls[0][0]).toBeCloseTo(800 / 3);
  });


  it('makes an angular skyline extending to the right edge only from signal bins', () => {
    const ctx = fakeContext();
    const history: number[][] = [];
    expect(paintFrequencyFrame(ctx, 900, 120, [0.2, 0.9, 0.4, 0.6], 'skyline', colours, history)).toBe(true);
    expect(get(ctx, 'fill')).toBe(1);
    expect(get(ctx, 'stroke')).toBe(1);
    expect(vi.mocked(ctx.lineTo).mock.calls.some(([x]) => x === 900)).toBe(true);
    expect(history).toEqual([]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('creates five separate full-width glass threads using individual frequency windows', () => {
    const ctx = fakeContext();
    const values = Array.from({ length: 50 }, (_, index) => index / 50);
    expect(paintFrequencyFrame(ctx, 1100, 140, values, 'threads', colours, [])).toBe(true);
    expect(get(ctx, 'stroke')).toBe(5);
    expect(get(ctx, 'fill')).toBe(0);
    expect(vi.mocked(ctx.lineTo).mock.calls.filter(([x]) => x === 1100)).toHaveLength(5);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('renders only non-silent signal pins with mirrored measured tips', () => {
    const ctx = fakeContext();
    expect(paintFrequencyFrame(ctx, 960, 120, [0.2, 0, 0.7, 1], 'pins', colours, [])).toBe(true);
    expect(get(ctx, 'stroke')).toBe(3);
    expect(get(ctx, 'arc')).toBe(6);
    expect(vi.mocked(ctx.arc).mock.calls[0][0]).toBeCloseTo(120);
    expect(vi.mocked(ctx.arc).mock.calls[0][1]).toBeCloseTo(60 - 0.2 * 120 * 0.43);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('quantizes only current-frame magnitudes into a wide six-row mosaic', () => {
    const ctx = fakeContext();
    expect(paintFrequencyFrame(ctx, 900, 120, [0.15, 0.5, 1], 'matrix', colours, [])).toBe(true);
    // One occupied threshold at 0.15, three at 0.5 and six at 1.
    expect(get(ctx, 'fillRect')).toBe(10);
    expect(get(ctx, 'stroke')).toBe(0);
    expect(vi.mocked(ctx.fillRect).mock.calls.every(([x, y, w, h]) =>
      x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 901 && y + h <= 121)).toBe(true);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('caps afterglow to seven real sampled frames, records silence, never invents history', () => {
    const ctx = fakeContext();
    const history: number[][] = [];
    for (let index = 0; index < 30; index += 1) {
      paintFrequencyFrame(ctx, 990, 140, [index / 30, 0.6, 0], 'trails', colours, history);
    }
    expect(history).toHaveLength(MAX_TRAIL_HISTORY);
    expect(history[0][0]).toBeCloseTo(23 / 30);
    expect(get(ctx, 'stroke')).toBeGreaterThan(0);
    const prev = history.map((frame) => [...frame]);
    paintFrequencyFrame(ctx, 990, 140, [0.2, 0.4, 0.6], 'skyline', colours, history);
    expect(history).toEqual(prev);
    for (let index = 0; index < MAX_TRAIL_HISTORY; index += 1) {
      const silentCtx = fakeContext();
      expect(paintFrequencyFrame(silentCtx, 990, 140, [0, 0, 0], 'trails', colours, history)).toBe(false);
      expect(get(silentCtx, 'stroke')).toBe(0);
    }
    expect(history).toEqual(Array.from({ length: MAX_TRAIL_HISTORY }, () => [0, 0, 0]));
    expect(paintFrequencyFrame(fakeContext(), 990, 140, [], 'trails', colours, history)).toBe(false);
    expect(history).toEqual([]);
  });

  it('draws identical measured geometry for repeated frames without random variation', () => {
    for (const mode of ['skyline', 'threads', 'pins', 'matrix', 'dunes', 'candles', 'mesh', 'split'] as SpectrumShape[]) {
      const a = fakeContext();
      const b = fakeContext();
      const levels = [0.1, 0.3, 0.8, 0, 0.4];
      paintFrequencyFrame(a, 840, 130, levels, mode, colours, []);
      paintFrequencyFrame(b, 840, 130, levels, mode, colours, []);
      for (const name of ['lineTo', 'arc', 'fillRect', 'moveTo'] as const) {
        expect(vi.mocked(a[name]).mock.calls).toEqual(vi.mocked(b[name]).mock.calls);
      }
    }
  });

  it('draws four full-width dunes from four disjoint frequency partitions', () => {
    const context = fakeContext();
    const history: number[][] = [];
    expect(paintFrequencyFrame(context, 1024, 160,
      [0.1, 0.2, 0.4, 0.7, 0.3, 0.6, 0.9, 0.8],
      'dunes', colours, history)).toBe(true);
    expect(get(context, 'fill')).toBe(4);
    expect(get(context, 'stroke')).toBe(4);
    expect(vi.mocked(context.lineTo).mock.calls.filter(([x]) => x === 1024).length).toBeGreaterThanOrEqual(4);
    expect(context.globalAlpha).toBe(1);
    expect(history).toEqual([]);
  });

  it('draws frequency range wicks and mean markers from actual contiguous groups', () => {
    const context = fakeContext();
    // Four three-bin groups; the second group contains measured silence only.
    const signal = [0.1, 0.5, 1, 0, 0, 0, 0.2, 0.4, 0.6, 0.8, 0.8, 0.8];
    expect(paintFrequencyFrame(context, 900, 140, signal, 'candles', colours, [])).toBe(true);
    expect(get(context, 'stroke')).toBe(3);
    expect(get(context, 'fillRect')).toBe(3);
    expect(vi.mocked(context.moveTo).mock.calls[0]).toEqual([112.5, 140 * 0.93 - 0.1 * 140 * 0.82]);
    expect(context.globalAlpha).toBe(1);
  });

  it('connects adjacent nonzero frequency mesh points but never jumps a silent gap', () => {
    const context = fakeContext();
    expect(paintFrequencyFrame(context, 900, 140, [0.2, 0, 0.7, 0.9], 'mesh', colours, [])).toBe(true);
    expect(get(context, 'stroke')).toBe(1);
    // Three active rungs (two line segments each) plus two diagonals for the
    // contiguous last two points; no diagonal may originate at x=0.
    const strokes = vi.mocked(context.moveTo).mock.calls;
    expect(strokes.filter(([x]) => x === 0)).toHaveLength(1);
    expect(strokes.filter(([x]) => x === 600)).toHaveLength(3);
    expect(strokes.some(([x]) => x === 300)).toBe(false);
    expect(context.globalAlpha).toBe(1);
  });

  it('keeps lower and upper frequency flow independent, never mirrors one half', () => {
    const lower = fakeContext();
    const higher = fakeContext();
    const both = fakeContext();
    paintFrequencyFrame(lower, 1000, 160, [0.2, 0.7, 0.9, 0, 0, 0], 'split', colours, []);
    paintFrequencyFrame(higher, 1000, 160, [0, 0, 0, 0.2, 0.7, 0.9], 'split', colours, []);
    paintFrequencyFrame(both, 1000, 160, [0.2, 0.7, 0.9, 0.9, 0.7, 0.2], 'split', colours, []);
    expect(get(lower, 'fill')).toBe(1);
    expect(get(higher, 'fill')).toBe(1);
    expect(get(both, 'fill')).toBe(2);
    expect(get(both, 'stroke')).toBe(2);
    expect(lower.globalAlpha).toBe(1);
    expect(higher.globalAlpha).toBe(1);
  });

  it.each(['dunes', 'candles', 'mesh', 'split'] as SpectrumShape[])(
    '%s never changes a preexisting measured history', (mode) => {
      const history = [[0.2, 0.4, 0.3]];
      paintFrequencyFrame(fakeContext(), 900, 140, [0.6, 0.4, 0.8], mode, colours, history);
      expect(history).toEqual([[0.2, 0.4, 0.3]]);
    },
  );

  it('bounds history, uses only real frames, and does not share it with other modes', () => {
    const context = fakeContext();
    const history: number[][] = [];
    for (let index = 0; index < 50; index += 1) {
      paintFrequencyFrame(context, 800, 110, [index / 50, 0.6, 0], 'waterfall', colours, history);
    }
    expect(history).toHaveLength(MAX_SPECTRUM_HISTORY);
    expect(history[0][0]).toBeCloseTo(26 / 50);
    const before = history.map((frame) => [...frame]);
    paintFrequencyFrame(context, 800, 110, [0.4, 0.6, 0], 'ribbon', colours, history);
    expect(history).toEqual(before);
    expect(get(context, 'fill')).toBeGreaterThan(0);
  });
});
