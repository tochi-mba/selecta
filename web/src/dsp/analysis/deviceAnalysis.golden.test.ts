import { describe, expect, it } from 'vitest';
import { analyseSong, measureSong, type SongDetail, type SongFacts } from './song';
import { buildGrid } from './grid';
import { barFrames } from './features';
import { renderSong, type SynthSong } from './synth';
import { browserBeatSource, BROWSER_BEATS_IMPLEMENTATION } from './beatSource';

// The device studio's whole-song measurement against the Desktop's Python analysis, on the
// synthetic songs of tools/device_analysis_golden.py (docs/engineering/device-analysis.md).
// `port` is Python fed the port's own resampler: every stage must match it nearly exactly, so a
// failure names the stage that drifted. `desktop` is Python fed soxr, as the Desktop runs: the
// port must match it within the planner's tolerances.

type Grid = {
  beats: number[]; barStarts: number[]; beatsPerBar: number; bpm: number; constantTempo: boolean;
  gridRmsMs: number; onsetAgreement: number; downbeatRegularity: number; tempoStability: number; confidence: number;
};
type Section = { start_bar: number; end_bar: number; label: string; energy: number; group: number; chorus_prob: number };
type Features = {
  chromaBars: number[][]; mfccBars: number[][]; energyBars: number[]; rmsDbBars: number[]; lowShareBars: number[];
  onsetDensityBars: number[]; timbre: number[]; energy: number; sections: Section[];
};
type Frames = {
  frames: number; tuning: number; sampleFrames: number[]; powerSum: number[]; logMel: number[][]; mfcc: number[][];
  chroma: number[][]; rmsDb: number[]; lowShare: number[]; flux: number[]; centroid: number[]; chromaProfile: number[];
};
type Reference = {
  monoLength: number; monoProbe: number[]; monoSum: number; monoSumSquares: number; envelope: number[];
  lufs: number; peakDb: number; peaks: number[]; regularizedBeats: number;
  grid: Grid | null; features: Features | null; frames?: Frames; barFrames?: number[];
  row: Record<string, unknown> | null;
};
type Fixture = { song: SynthSong & { rawBeats: number[]; rawDownbeats: number[]; trueBpm: number | null }; port: Reference; desktop: Reference };

const files = import.meta.glob('../golden/device-analysis/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const manifest = JSON.parse(files['../golden/device-analysis/manifest.json']) as { songs: Array<{ name: string; file: string }> };
const fixtures = manifest.songs.map((entry) => JSON.parse(files[`../golden/device-analysis/${entry.file}`]) as Fixture);

const runs = new Map<string, { facts: SongFacts; detail: SongDetail }>();
/** One measurement per song, shared by every test below: the tracker's beats as the fixture
 * gives them, exactly where Beat This's would go. */
function measured(fixture: Fixture) {
  const cached = runs.get(fixture.song.name);
  if (cached) return cached;
  const channels = renderSong(fixture.song);
  const beats = {
    beats: Float64Array.from(fixture.song.rawBeats),
    downbeats: Float64Array.from(fixture.song.rawDownbeats),
    confidence: 1,
    implementation: 'golden-tracker-beats',
  };
  const run = analyseSong(channels, fixture.song.sampleRate, beats);
  runs.set(fixture.song.name, run);
  return run;
}

const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let k = 0; k < a.length; k += 1) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  return worst;
};
const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < a.length; k += 1) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return dot / Math.max(Math.sqrt(na * nb), 1e-12);
};
const rows = (flat: ArrayLike<number>, width: number) =>
  Array.from({ length: flat.length / width }, (_, row) => Array.from(flat).slice(row * width, row * width + width));

const SLOW = 120_000;

describe('the golden fixtures', () => {
  it('cover the songs the generator wrote, at both rates, with and without a beat', () => {
    expect(fixtures.length).toBe(7);
    expect(new Set(fixtures.map((f) => f.song.sampleRate))).toEqual(new Set([44100, 48000]));
    expect(fixtures.some((f) => f.port.grid === null)).toBe(true);
    expect(fixtures.some((f) => f.port.grid?.constantTempo === false)).toBe(true);
    expect(fixtures.some((f) => f.port.grid?.beatsPerBar === 3)).toBe(true);
  });
});

describe.each(fixtures.map((fixture) => [fixture.song.name, fixture] as const))('%s: each stage against Python on the same signal', (_name, fixture) => {
  const port = fixture.port;

  it('resamples to the same 22,050 Hz signal', () => {
    const { detail } = measured(fixture);
    const mono = detail.mono22k;
    expect(mono.length).toBe(port.monoLength);
    let sum = 0;
    let squares = 0;
    for (let k = 0; k < mono.length; k += 1) {
      sum += mono[k];
      squares += mono[k] * mono[k];
    }
    // float32 samples a last bit apart, summed over some 700,000 samples
    expect(Math.abs(sum - port.monoSum)).toBeLessThan(1e-3);
    expect(relative(squares, port.monoSumSquares)).toBeLessThan(1e-6);
    const probes = [0, 1000, 5000, 22050, 100000].filter((index) => index < mono.length);
    expect(maxAbs(probes.map((index) => mono[index]), port.monoProbe)).toBeLessThan(1e-6);
  }, SLOW);

  it('takes the same onset envelope', () => {
    const { detail } = measured(fixture);
    expect(maxAbs(detail.envelope, port.envelope)).toBeLessThan(1e-3);
  }, SLOW);

  it('builds the same grid from the same envelope', () => {
    const grid = buildGrid(Float64Array.from(fixture.song.rawBeats), Float64Array.from(fixture.song.rawDownbeats), Float32Array.from(port.envelope));
    if (!port.grid) {
      expect(grid === null || grid.barStarts.length < 4).toBe(true);
      return;
    }
    expect(grid).not.toBeNull();
    expect(maxAbs(grid!.beats, port.grid.beats)).toBeLessThan(1e-6);
    expect(Array.from(grid!.barStarts)).toEqual(port.grid.barStarts);
    expect(grid!.beatsPerBar).toBe(port.grid.beatsPerBar);
    expect(grid!.constantTempo).toBe(port.grid.constantTempo);
    expect(Math.abs(grid!.bpm - port.grid.bpm)).toBeLessThan(1e-6);
    expect(Math.abs(grid!.gridRmsMs - port.grid.gridRmsMs)).toBeLessThan(1e-6);
    expect(grid!.onsetAgreement).toBeCloseTo(port.grid.onsetAgreement, 12);
    expect(grid!.downbeatRegularity).toBeCloseTo(port.grid.downbeatRegularity, 12);
    expect(Math.abs(grid!.tempoStability - port.grid.tempoStability)).toBeLessThan(1e-9);
    expect(Math.abs(grid!.confidence - port.grid.confidence)).toBeLessThan(1e-9);
  });

  it('builds the grid within the planner tolerance from its own envelope', () => {
    const { detail } = measured(fixture);
    if (!port.grid) {
      expect(detail.grid).toBeNull();
      return;
    }
    expect(detail.grid).not.toBeNull();
    expect(maxAbs(detail.grid!.beats, port.grid.beats)).toBeLessThan(0.002);
    expect(Math.abs(detail.grid!.bpm - port.grid.bpm)).toBeLessThan(0.05);
    expect(Math.abs(detail.grid!.confidence - port.grid.confidence)).toBeLessThan(0.02);
    expect(Array.from(detail.grid!.barStarts)).toEqual(port.grid.barStarts);
  }, SLOW);

  it('measures the same frame-level features', () => {
    const { detail } = measured(fixture);
    if (!port.frames) return;
    const frames = detail.frames!;
    const ref = port.frames;
    expect(frames.frames).toBe(ref.frames);
    expect(Math.abs(frames.tuning - ref.tuning)).toBeLessThan(1e-9);
    expect(maxAbs(frames.rmsDb, ref.rmsDb)).toBeLessThan(1e-3);
    expect(maxAbs(frames.lowShare, ref.lowShare)).toBeLessThan(1e-5);
    expect(maxAbs(frames.flux, ref.flux)).toBeLessThan(1e-3);
    let centroidWorst = 0;
    for (let k = 0; k < frames.frames; k += 1) centroidWorst = Math.max(centroidWorst, Math.abs(frames.centroid[k] - ref.centroid[k]) / Math.max(ref.centroid[k], 1));
    expect(centroidWorst).toBeLessThan(1e-4);
    ref.sampleFrames.forEach((frame, slot) => {
      expect(relative(frames.powerSum[frame], ref.powerSum[slot])).toBeLessThan(1e-5);
      expect(maxAbs(frames.logMel.subarray(frame * 64, frame * 64 + 64), ref.logMel[slot])).toBeLessThan(1e-3);
      expect(maxAbs(frames.mfcc.subarray(frame * 20, frame * 20 + 20), ref.mfcc[slot])).toBeLessThan(1e-2);
      expect(maxAbs(frames.chroma.subarray(frame * 12, frame * 12 + 12), ref.chroma[slot])).toBeLessThan(1e-4);
    });
  }, SLOW);

  it('averages the same bar features, sections and key', () => {
    const { detail, facts } = measured(fixture);
    if (!port.features) {
      expect(facts.row).toBeNull();
      expect(facts.error).toBe('no steady beat found');
      return;
    }
    const features = detail.features!;
    const ref = port.features;
    const barTimes = Float64Array.from(port.grid!.barStarts, (index) => port.grid!.beats[index]);
    expect(Array.from(barFrames(barTimes, facts.duration_s))).toEqual(port.barFrames);
    for (let bar = 0; bar < ref.energyBars.length; bar += 1) {
      expect(Math.abs(features.energyBars[bar] - ref.energyBars[bar])).toBeLessThan(1e-4 * Math.max(ref.energyBars[bar], 1e-3) + 1e-9);
    }
    expect(maxAbs(features.rmsDbBars, ref.rmsDbBars)).toBeLessThan(1e-3);
    expect(maxAbs(features.lowShareBars, ref.lowShareBars)).toBeLessThan(1e-5);
    expect(maxAbs(features.onsetDensityBars, ref.onsetDensityBars)).toBeLessThan(1e-3);
    rows(features.chromaBars, 12).forEach((bar, k) => expect(cosine(bar, ref.chromaBars[k])).toBeGreaterThanOrEqual(0.99999));
    expect(maxAbs(features.mfccBars, ref.mfccBars.flat())).toBeLessThan(1e-2);
    expect(maxAbs(features.timbre.subarray(0, 26), ref.timbre.slice(0, 26))).toBeLessThan(1e-2);
    expect(relative(features.timbre[26], ref.timbre[26])).toBeLessThan(1e-5);
    expect(maxAbs(features.timbre.subarray(27), ref.timbre.slice(27))).toBeLessThan(1e-4);
    expect(Math.abs(features.energy - ref.energy)).toBeLessThan(1e-4);
    expect(features.sections.map((s) => [s.start_bar, s.end_bar, s.label, s.group])).toEqual(ref.sections.map((s) => [s.start_bar, s.end_bar, s.label, s.group]));
    features.sections.forEach((section, k) => {
      expect(Math.abs(section.energy - ref.sections[k].energy)).toBeLessThan(0.0011);
      expect(Math.abs(section.chorus_prob - ref.sections[k].chorus_prob)).toBeLessThan(0.0011);
    });
    expect(facts.row!.key).toBe(port.row!.key);
    expect(facts.row!.camelot).toBe(port.row!.camelot);
    expect(facts.row!.key_confidence).toBe(port.row!.key_confidence);
  }, SLOW);

  it('measures the same loudness, peak and waveform', () => {
    const { detail, facts } = measured(fixture);
    expect(Math.abs(detail.lufs - port.lufs)).toBeLessThan(1e-6);
    expect(Math.abs(detail.peakDb - port.peakDb)).toBeLessThan(1e-5);
    if (facts.arrays) expect(maxAbs(facts.arrays.peaks, port.peaks)).toBeLessThanOrEqual(1);
  }, SLOW);

  it('stores the row Python stores', () => {
    const { facts } = measured(fixture);
    if (!port.row) return;
    const row = facts.row!;
    const ref = port.row as Record<string, number | string>;
    for (const name of ['constant_tempo', 'beats_per_bar', 'key', 'camelot', 'key_confidence', 'key_agrees_chroma']) {
      expect(row[name as keyof typeof row]).toBe(ref[name]);
    }
    expect(Math.abs(row.bpm - (ref.bpm as number))).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(Math.abs(row.grid_confidence - (ref.grid_confidence as number))).toBeLessThanOrEqual(0.001 + 1e-9);
    expect(Math.abs(row.lufs - (ref.lufs as number))).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(Math.abs(row.peak_db - (ref.peak_db as number))).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(Math.abs(row.energy - (ref.energy as number))).toBeLessThanOrEqual(0.001 + 1e-9);
    expect(facts.implementation).toBe('web-dsp-1');
    expect(facts.analysis_version).toBe(3);
    expect(facts.arrays!.beats).toBeInstanceOf(Float64Array);
    expect(facts.arrays!.bar_starts).toBeInstanceOf(Int32Array);
    expect(facts.arrays!.chroma_bars.length).toBe(facts.arrays!.bar_starts.length * 12);
    expect(facts.arrays!.mfcc_bars.length).toBe(facts.arrays!.bar_starts.length * 20);
  }, SLOW);
});

describe.each(fixtures.map((fixture) => [fixture.song.name, fixture] as const))('%s: end to end against the Desktop (soxr)', (_name, fixture) => {
  const desktop = fixture.desktop;

  it('agrees within the planner tolerances', () => {
    const { facts, detail } = measured(fixture);
    expect(Math.abs(detail.lufs - desktop.lufs)).toBeLessThan(0.2);
    expect(Math.abs(detail.peakDb - desktop.peakDb)).toBeLessThan(0.2);
    if (!desktop.grid) {
      expect(facts.row).toBeNull();
      return;
    }
    const grid = detail.grid!;
    expect(Math.abs(grid.bpm - desktop.grid.bpm)).toBeLessThan(0.05);
    expect(maxAbs(grid.beats, desktop.grid.beats)).toBeLessThan(0.002);
    expect(Math.abs(grid.confidence - desktop.grid.confidence)).toBeLessThan(0.02);
    const features = detail.features!;
    const ref = desktop.features!;
    for (let bar = 0; bar < ref.energyBars.length; bar += 1) {
      expect(Math.abs(features.energyBars[bar] - ref.energyBars[bar])).toBeLessThanOrEqual(0.01 * Math.max(ref.energyBars[bar], 1e-3));
    }
    rows(features.chromaBars, 12).forEach((bar, k) => expect(cosine(bar, ref.chromaBars[k])).toBeGreaterThanOrEqual(0.995));
    expect(facts.row!.key).toBe(desktop.row!.key);
    expect(features.sections.length).toBe(ref.sections.length);
    features.sections.forEach((section, k) => expect(Math.abs(section.start_bar - ref.sections[k].start_bar)).toBeLessThanOrEqual(1));
  }, SLOW);
});

describe('the interim beat source', () => {
  it('finds a four-on-the-floor tempo over the whole song and says which source it is', () => {
    const fixture = fixtures.find((f) => f.song.name === 'house-124-d-minor-48k')!;
    const { facts } = measureSong(renderSong(fixture.song), fixture.song.sampleRate, browserBeatSource);
    expect(facts.beat_source).toBe(BROWSER_BEATS_IMPLEMENTATION);
    expect(facts.row).not.toBeNull();
    expect(Math.abs(facts.row!.bpm - 124) / 124).toBeLessThan(0.02);
  }, SLOW);

  it('finds no beat in a song without one', () => {
    const fixture = fixtures.find((f) => f.song.name === 'beatless-pad-e-major')!;
    const { facts } = measureSong(renderSong(fixture.song), fixture.song.sampleRate, browserBeatSource);
    expect(facts.row).toBeNull();
    expect(facts.error).toBe('no steady beat found');
  }, SLOW);
});
