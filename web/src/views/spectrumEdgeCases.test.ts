import { describe, expect, it, vi } from 'vitest';
import type { SongDetail } from '../api';
import { createFeatureTracker, bytesToDb, LEVEL_COUNT, type Features } from './visualizer/features';
import { createFrameSource, gridOf } from './visualizer/source';
import { createVisualState, paintVisualFrame, SPECTRUM_MODES, type SpectrumShape } from './spectrumVisuals';

const METHODS = [
  'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath',
  'fill', 'stroke', 'fillRect', 'rect', 'arc', 'ellipse',
] as const;
type Method = typeof METHODS[number];
function recorder() {
  const fns = Object.fromEntries(METHODS.map((name) => [name, vi.fn()]));
  return {
    ...fns, createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: 'butt',
  } as unknown as CanvasRenderingContext2D;
}
const brush = { accent: '#d5f36b', soft: '#ffffff', gradient: '#d5f36b' };
const calls = (ctx: CanvasRenderingContext2D, name: Method) => vi.mocked(ctx[name]).mock.calls;
const geometry = (ctx: CanvasRenderingContext2D) => METHODS.map((name) => calls(ctx, name));

function measured(now = 1000): Features {
  const f = createFeatureTracker().update({
    now, db: new Float32Array(512).fill(-60), sampleRate: 44100,
    songTime: 1.25, grid: { beats: [0, 0.5, 1, 1.5, 2], bars: [0, 2], sections: [0], beatsPerBar: 4 },
  });
  expect(f.silent).toBe(false);
  return {
    ...f, kick: 0.8, snare: 0.6, hat: 0.5, onset: 0.8, kicks: 1, snares: 1, hats: 1, onsets: 3,
    section: 1, sectionPulse: 0.7,
    hits: [
      { at: now, kind: 'kick', position: 0.15, strength: 0.8 },
      { at: now, kind: 'snare', position: 0.55, strength: 0.6 },
      { at: now, kind: 'hat', position: 0.85, strength: 0.5 },
    ],
  };
}
function paint(mode: SpectrumShape, f = measured(), width = 900, state = createVisualState()) {
  const context = recorder();
  const drew = paintVisualFrame(context, width, 140, f, mode, brush, state);
  return { context, state, drew };
}

describe('measured feature input and bounds', () => {
  it('converts the real byte analyser range to dB monotonically, without inventing sound', () => {
    const db = bytesToDb(Uint8Array.from([0, 64, 128, 255]));
    expect([...db]).toHaveLength(4);
    expect(db[0]).toBe(-100);
    expect(db[3]).toBe(-30);
    expect(db[0]).toBeLessThan(db[1]);
    expect(db[1]).toBeLessThan(db[2]);
    expect(db[2]).toBeLessThan(db[3]);
  });

  it('does not classify analyser silence as music, and clears its envelopes after sound stops', () => {
    const tracker = createFeatureTracker();
    const quiet = tracker.update({ now: 100, db: new Float32Array(512).fill(-100), sampleRate: 44100 });
    expect(quiet.silent).toBe(true);
    expect([...quiet.levels].every((value) => value === 0)).toBe(true);
    const active = tracker.update({ now: 133, db: new Float32Array(512).fill(-57), sampleRate: 44100 });
    expect(active.silent).toBe(false);
    expect(active.levels).toHaveLength(LEVEL_COUNT);
    expect([...active.levels].some((value) => value > 0)).toBe(true);
    const missing = tracker.update({ now: 166, db: null, sampleRate: 44100 });
    expect(missing.silent).toBe(true);
    expect([...missing.levels].every((value) => value === 0)).toBe(true);
    expect(missing.kick).toBe(0);
  });

  it('samples the real mixer and passes the analysed song grid to the feature detector', () => {
    const getSpectrum = vi.fn(() => Uint8Array.from([0, 128, 255]));
    const source = createFrameSource({ getSpectrum, state: { songTime: 3 } });
    const grid = { beats: [0, 1, 2, 3, 4], bars: [0, 4], sections: [0], beatsPerBar: 4 };
    const frame = source.read(200, grid);
    expect(getSpectrum).toHaveBeenCalledOnce();
    expect(frame?.db?.[0]).toBe(-100);
    expect(frame?.db?.[2]).toBe(-30);
    expect(frame?.sampleRate).toBe(44100);
    expect(frame?.songTime).toBe(3);
    expect(frame?.grid).toEqual(grid);
    expect(source.read(300, grid)?.songTime).toBeCloseTo(3.1);
    const song = {
      beat_times: [1, 2], bar_times: [1, 3], beats_per_bar: 4,
      sections: [{ start: 8 }, { start: 2 }],
    } as unknown as SongDetail;
    expect(gridOf(song)).toEqual({ beats: [1, 2], bars: [1, 3], sections: [2, 8], beatsPerBar: 4 });
    expect(gridOf(null)).toBeNull();
  });
});

describe('all fifteen renderers remain deterministic and bounded', () => {
  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s draws exactly the same geometry from the same features and fresh state', (mode) => {
      const feature = measured();
      const first = paint(mode, feature);
      const second = paint(mode, feature);
      expect(first.drew).toBe(true);
      expect(geometry(first.context)).toEqual(geometry(second.context));
    },
  );

  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s keeps measured geometry finite at 320px and 2560px', (mode) => {
      for (const width of [320, 2560]) {
        const { context, drew } = paint(mode, measured(), width);
        expect(drew).toBe(true);
        for (const name of ['moveTo', 'lineTo', 'rect', 'fillRect', 'arc', 'ellipse'] as Method[]) {
          for (const args of calls(context, name)) {
            const [x, y] = args as number[];
            expect(Number.isFinite(x)).toBe(true);
            expect(Number.isFinite(y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(-Math.max(8, width * 0.05));
            expect(x).toBeLessThanOrEqual(width * 1.05 + 8);
            expect(y).toBeGreaterThanOrEqual(-28);
            expect(y).toBeLessThanOrEqual(168);
          }
        }
        expect(context.globalAlpha).toBe(1);
      }
    },
  );

  it('changes frequency bar heights when measured levels change, without changing the number of bars', () => {
    const normal = measured();
    const flat = { ...normal, kick: 0, levels: new Float32Array(LEVEL_COUNT) };
    const loud = { ...flat, levels: new Float32Array(LEVEL_COUNT).fill(1) };
    const a = paint('bars', flat, 320);
    const b = paint('bars', loud, 320);
    expect(a.state.peaks?.length).toBe(35);
    expect(b.state.peaks?.length).toBe(35);
    expect((calls(b.context, 'fillRect')[0] as number[])[3])
      .toBeGreaterThan((calls(a.context, 'fillRect')[0] as number[])[3]);
    expect(paint('bars', normal, 2560).state.peaks?.length).toBe(72);
  });

  it('prunes old snare and kick shockwaves rather than leaving permanent decoration', () => {
    const state = createVisualState();
    paint('shock', measured(1000), 900, state);
    expect(state.events.length).toBeGreaterThan(0);
    paint('shock', { ...measured(2500), hits: [] }, 900, state);
    expect(state.events).toHaveLength(0);
  });

  it('caps scrolling spectral and energy history, never accumulating unlimited frames', () => {
    for (const [mode, key, cap] of [
      ['waterfall', 'columns', 96], ['river', 'streams', 160], ['tracer', 'trail', 48],
    ] as const) {
      const state = createVisualState();
      for (let index = 0; index < cap + 20; index += 1) paint(mode, measured(1000 + index * 40), 900, state);
      expect(state[key]).toHaveLength(cap);
    }
  });

  it('forgets all measured style history on a silent frame, without drawing any primitives', () => {
    const state = createVisualState();
    paint('tracer', measured(1000), 900, state);
    expect(state.trail).toHaveLength(1);
    const silent = createFeatureTracker().update({ now: 2000, db: null, sampleRate: 44100 });
    const { context, drew } = paint('tracer', silent, 900, state);
    expect(drew).toBe(false);
    expect(state.trail).toHaveLength(0);
    expect(geometry(context).every((set) => set.length === 0)).toBe(true);
  });
});
