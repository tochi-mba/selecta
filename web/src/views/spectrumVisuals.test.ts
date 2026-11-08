import { describe, expect, it, vi } from 'vitest';
import {
  frequencyLevels, MAX_SPECTRUM_HISTORY, paintFrequencyFrame,
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

describe('six width-first audio visualizations', () => {
  it('declares four additional modes, each with a non-audio description', () => {
    expect(SPECTRUM_MODES.map((mode) => mode.id))
      .toEqual(['bars', 'ribbon', 'aurora', 'lanes', 'constellation', 'waterfall']);
    expect(new Set(SPECTRUM_MODES.map((mode) => mode.label)).size).toBe(6);
  });

  it('groups only actual nonzero bins, keeps silence at zero and refuses absent signal', () => {
    expect(frequencyLevels(new Uint8Array(), 12)).toEqual([]);
    expect(frequencyLevels(new Uint8Array(24), 12)).toEqual(Array(12).fill(0));
    expect(frequencyLevels(Uint8Array.from([0, 0, 128, 255]), 4).some((value) => value === 1)).toBe(true);
    expect(frequencyLevels(Uint8Array.from([0, 0, 128, 255]), 4).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(spectrumLevelCount(1080, 1, 'aurora')).toBeGreaterThan(spectrumLevelCount(200, 2, 'aurora'));
    expect(spectrumLevelCount(100000, 1, 'aurora')).toBe(128);
  });

  it.each(['bars', 'ribbon', 'aurora', 'lanes', 'constellation', 'waterfall'] as SpectrumShape[])(
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
