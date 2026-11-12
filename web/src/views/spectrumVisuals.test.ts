import { describe, expect, it, vi } from 'vitest';
import { createFeatureTracker, type Features } from './visualizer/features';
import {
  createVisualState, migrateSpectrumShape, paintVisualFrame, RETIRED_SPECTRUM_SHAPES,
  SPECTRUM_MODES, type SpectrumShape,
} from './spectrumVisuals';

const METHODS = [
  'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill',
  'stroke', 'fillRect', 'arc', 'rect', 'ellipse',
] as const;
type Method = typeof METHODS[number];

function recorder() {
  const methods = Object.fromEntries(METHODS.map((name) => [name, vi.fn()]));
  return {
    ...methods, createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
  } as unknown as CanvasRenderingContext2D;
}
const brush = { accent: '#d5f36b', soft: '#ffffff', gradient: '#d5f36b' };
const calls = (context: CanvasRenderingContext2D, name: Method) => vi.mocked(context[name]).mock.calls;
const paintedMarks = (context: CanvasRenderingContext2D) =>
  METHODS.reduce((count, name) => count + calls(context, name).length, 0);

/** A frame measured from a real dB spectrum, with a recorded beat and transient.
 * Specific painter tests vary only the measured feature under examination. */
function sound(now = 1000): Features {
  const measured = createFeatureTracker().update({
    now, db: new Float32Array(512).fill(-57), sampleRate: 44100,
    songTime: 1, grid: { beats: [0, 0.5, 1, 1.5, 2], bars: [0, 2], sections: [0], beatsPerBar: 4 },
  });
  expect(measured.silent).toBe(false);
  return {
    ...measured, kick: 0.8, snare: 0.6, hat: 0.5, onset: 0.8,
    hits: [
      { at: now, kind: 'kick', strength: 0.8, position: 0.14 },
      { at: now, kind: 'snare', strength: 0.6, position: 0.54 },
      { at: now, kind: 'hat', strength: 0.5, position: 0.88 },
    ],
    kicks: 1, snares: 1, hats: 1, onsets: 3, section: 1, sectionPulse: 0.8,
  };
}
function paint(mode: SpectrumShape, features = sound(), state = createVisualState(), width = 900) {
  const context = recorder();
  const drew = paintVisualFrame(context, width, 140, features, mode, brush, state);
  return { context, state, drew };
}

describe('fifteen feature-driven real-audio visualizations', () => {
  it('exposes exactly the fifteen current, distinct, documented choices', () => {
    expect(SPECTRUM_MODES.map((mode) => mode.id)).toEqual([
      'bars', 'pulse', 'lanes', 'ribbon', 'horizon', 'sparkle', 'scope',
      'stereo', 'waterfall', 'bursts', 'wash', 'river', 'grid', 'shock', 'tracer',
    ]);
    expect(new Set(SPECTRUM_MODES.map((mode) => mode.label)).size).toBe(15);
    expect(SPECTRUM_MODES.every((mode) => mode.description.length > 12)).toBe(true);
  });

  it('keeps current saved choices and migrates every retired choice to an existing style', () => {
    for (const mode of SPECTRUM_MODES) expect(migrateSpectrumShape(mode.id)).toBe(mode.id);
    for (const [old, next] of Object.entries(RETIRED_SPECTRUM_SHAPES)) {
      expect(migrateSpectrumShape(old)).toBe(next);
      expect(SPECTRUM_MODES.map((mode) => mode.id)).toContain(next);
    }
    expect(migrateSpectrumShape('radial')).toBe('ribbon');
    expect(migrateSpectrumShape('unknown-style')).toBe('bars');
    expect(migrateSpectrumShape(null)).toBe('bars');
  });

  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s never paints fictitious geometry from missing or silent analyser output', (mode) => {
      const context = recorder();
      const state = createVisualState();
      const silent = createFeatureTracker().update({ now: 1000, db: null, sampleRate: 44100 });
      expect(silent.silent).toBe(true);
      expect(paintVisualFrame(context, 900, 140, silent, mode, brush, state)).toBe(false);
      expect(paintedMarks(context)).toBe(0);
      expect(context.globalAlpha).toBe(1);
    },
  );

  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s responds to the measured feature frame and restores canvas opacity', (mode) => {
      const { context, drew } = paint(mode);
      expect(drew).toBe(true);
      expect(paintedMarks(context)).toBeGreaterThan(0);
      expect(context.globalAlpha).toBe(1);
    },
  );

  it('retains only the latest 96 measured spectrogram columns', () => {
    const state = createVisualState();
    for (let index = 0; index < 140; index += 1) {
      paint('waterfall', sound(1000 + index * 40), state);
    }
    expect(state.columns).toHaveLength(96);
    expect(state.columns.every((column) => column.levels.length === 32)).toBe(true);
    expect(state.columns.at(-1)?.kick).toBeCloseTo(0.8);
  });

  it('clears mode-specific history on a switch and clears all history on silence', () => {
    const state = createVisualState();
    paint('waterfall', sound(), state);
    expect(state.columns).toHaveLength(1);
    paint('bars', sound(), state);
    expect(state.columns).toHaveLength(0);
    expect(state.peaks).toBeInstanceOf(Float32Array);
    const silent = createFeatureTracker().update({ now: 3000, db: null, sampleRate: 44100 });
    const { context, drew } = paint('bars', silent, state);
    expect(drew).toBe(false);
    expect(state.peaks).toBeNull();
    expect(paintedMarks(context)).toBe(0);
  });

  it('uses actual hit positions for onset particles and expires old particles', () => {
    const state = createVisualState();
    const { context } = paint('bursts', sound(), state);
    expect(state.particles.length).toBeGreaterThan(0);
    expect(calls(context, 'arc').length + calls(context, 'fill').length).toBeGreaterThan(0);
    paint('bursts', { ...sound(4000), hits: [] }, state);
    expect(state.particles).toHaveLength(0);
  });

  it('uses the measured waveform for scope rather than a generated oscillator', () => {
    const a = sound();
    const wave = new Float32Array(256);
    wave[0] = 0.8;
    wave[1] = -0.8;
    const real = paint('scope', { ...a, wave }).context;
    const fallback = paint('scope', { ...a, wave: null }).context;
    expect(calls(real, 'lineTo').length).toBeGreaterThan(200);
    expect(calls(fallback, 'lineTo')).toHaveLength(2);
    expect(calls(real, 'moveTo')[0]).not.toEqual(calls(fallback, 'moveTo')[0]);
  });

  it('spreads stereo bands according to measured stereo width', () => {
    const feature = { ...sound(), kick: 0, width: 0.0, balance: 0 };
    const narrow = paint('stereo', feature).context;
    const wide = paint('stereo', { ...feature, width: 1 }).context;
    const wideWidth = calls(wide, 'fillRect')[0]?.[2];
    const narrowWidth = calls(narrow, 'fillRect')[0]?.[2];
    expect(wideWidth).toBeTypeOf('number');
    expect(narrowWidth).toBeTypeOf('number');
    expect(wideWidth!).toBeGreaterThan(narrowWidth!);
  });
});
