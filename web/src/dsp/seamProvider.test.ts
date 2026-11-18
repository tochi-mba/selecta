import { describe, expect, it } from 'vitest';
import { CapabilityRegistry, registerBrowserDspCapabilities } from './capability';
import { abilitiesFrom, abilityOf, analyseTiming, beatGrid, calibrateAnalysis, makeSeamProvider, sliceMono, type PcmLike, type SeamRecord } from './seamProvider';
import type { TrackTiming } from './seams';

function clicks(bpm: number, seconds: number, sampleRate = 22050, phase = 0.1): PcmLike {
  const pcm = new Float32Array(seconds * sampleRate);
  const period = 60 / bpm;
  for (let beat = phase; beat < seconds; beat += period) {
    const at = Math.round(beat * sampleRate);
    for (let index = 0; index < 400 && at + index < pcm.length; index += 1) {
      pcm[at + index] = Math.sin(index * 0.3) * Math.exp(-index / 80);
    }
  }
  return { sampleRate, duration: seconds, numberOfChannels: 1, getChannelData: () => pcm };
}

const timing = (bpm: number, confidence = 0.9): TrackTiming => ({
  beats: Array.from({ length: 300 }, (_, beat) => beat * (60 / bpm)),
  tempo: { bpm, confidence, ambiguous: false },
  durationSeconds: 120,
});

const ready = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: { atFloor: false } });
const status = (feature: string) => ready.get(feature);

describe('analysis for seams', () => {
  it('lays a constant-tempo grid on the phase most onsets sit on, across the whole song', () => {
    const grid = beatGrid(120, [10.1, 10.6, 11.1, 11.6, 3.33], 20);
    expect(grid[0]).toBeCloseTo(0.1, 1);
    expect(grid.at(-1)).toBeLessThan(20);
    expect(grid.length).toBe(40);
    expect(beatGrid(0, [1], 10)).toEqual([]);
  });

  it('analyses only a bounded slice: the tail of the outgoing song, offset to song time', () => {
    const song = clicks(120, 90);
    const tail = sliceMono(song, 'tail', 60);
    expect(tail.offset).toBeCloseTo(30, 6);
    expect(tail.pcm.length).toBe(60 * song.sampleRate);
    const found = analyseTiming(song, 'tail');
    expect(found.tempo.bpm).toBeGreaterThan(118);
    expect(found.tempo.bpm).toBeLessThan(122);
    // the grid sits on the clicks, which start at 0.1 s
    const near = found.beats.find((beat) => beat > 60)!;
    const off = ((near - 0.1) % 0.5 + 0.5) % 0.5;
    expect(Math.min(off, 0.5 - off)).toBeLessThan(0.04);
  });

  it('calibrates a real worker budget from measured analysis time', () => {
    const budget = calibrateAnalysis(1, 1, 8000);
    expect(budget.msPerBlock).toBeGreaterThan(0);
    expect(budget.atFloor).toBe(false);
  });
});

describe('the seam provider', () => {
  it('scripts the move the incoming song\'s seam settings name, and records it', () => {
    const records: SeamRecord[] = [];
    const provider = makeSeamProvider({
      settingsFor: (toIndex) => (toIndex === 1 ? { move: 'filter_sweep', bars: 4, exit_bar: 20 } : null),
      abilities: () => abilitiesFrom(status),
      sourceOf: () => 'device',
      timing: () => timing(120),
      onPlanned: (record) => records.push(record),
    });
    const song = clicks(120, 1);
    const schedule = provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(schedule.style).toBe('filter_sweep');
    expect(schedule.kind).toBe('beatmatch');
    expect(records).toEqual([{ fromIndex: 0, toIndex: 1, sources: { a: 'device', b: 'device' }, schedule }]);
  });

  it('reads abilities from the capability record: EQ ready, stretch and stems not', () => {
    const abilities = abilitiesFrom(status);
    expect(abilities.eqFilters).toEqual({ ok: true });
    expect(abilities.beatmatch).toEqual({ ok: true });
    expect(abilities.stretch.ok).toBe(false);
    expect(abilities.stems.ok).toBe(false);
    const unmeasured = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true } });
    expect(abilitiesFrom((feature) => unmeasured.get(feature)).beatmatch.ok).toBe(false);
    expect(abilityOf(status, 'seam_source_hosted')).toEqual({ ok: true });
  });

  it('joins a device and a hosted song with the move when both paths are seam-safe', () => {
    const provider = makeSeamProvider({
      settingsFor: () => ({ move: 'bass_swap_blend', bars: 4, exit_bar: 20 }),
      abilities: () => abilitiesFrom(status),
      sourceOf: (index) => (index === 0 ? 'device' : 'hosted'),
      sourceSafe: (source) => abilityOf(status, `seam_source_${source}`),
      timing: () => timing(120),
    });
    const song = clicks(120, 1);
    expect(provider({ fromIndex: 0, from: song, toIndex: 1, to: song }).style).toBe('bass_swap_blend');
  });

  it('falls back to a labelled fade for a mixed-source seam the record does not call safe', () => {
    const provider = makeSeamProvider({
      settingsFor: () => ({ move: 'bass_swap_blend' }),
      abilities: () => abilitiesFrom(status),
      sourceOf: (index) => (index === 0 ? 'device' : 'hosted'),
      sourceSafe: (source) => (source === 'hosted' ? { ok: false, reason: 'the hosted copy streams' } : { ok: true }),
      timing: () => timing(120),
    });
    const song = clicks(120, 1);
    const schedule = provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(schedule.kind).toBe('fade');
    expect(schedule.reason).toContain('mixed-source');
    expect(schedule.degraded?.[0]).toMatchObject({ wanted: 'bass_swap_blend', instead: 'fade' });
    expect(schedule.startSeconds).toBeGreaterThanOrEqual(30);
  });
});
