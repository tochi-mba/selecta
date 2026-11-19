import { describe, expect, it } from 'vitest';
import { abilitiesFrom, makeWorkerSeamProvider, recordable, type PcmLike, type SeamRecord } from './seamProvider';
import { CapabilityRegistry, registerBrowserDspCapabilities } from './capability';
import { WORKER_CALIBRATION_IMPLEMENTATION, type WorkerBudgetEvidence } from './budget';
import type { SeamSchedule, TrackTiming } from './seams';
import { scriptSeam, type SeamAbilities } from './seamScript';
import { NORMAL_MOVE_WEIGHTS, refusalCode, stemsFirstAt, withStemMove, type StemReading } from './stemSchedule';
import type { StemSet } from './stems/cache';
import { rampCurve, timeStretch } from './stretch';

const RATE = 8000;

function track(bpm: number, duration = 100): TrackTiming {
  const period = 60 / bpm;
  return { beats: Array.from({ length: Math.floor(duration / period) }, (_, beat) => beat * period), tempo: { bpm, confidence: 0.9, ambiguous: false }, durationSeconds: duration };
}

/** A stem set over [from, to) song seconds: a 220 Hz voice over `lines`, quiet noise elsewhere. */
function stemSet(from: number, to: number, lines: Array<[number, number]>): StemSet {
  const length = Math.round((to - from) * RATE);
  const voice = new Float32Array(length);
  for (const [start, end] of lines) {
    for (let index = Math.round((start - from) * RATE); index < Math.round((end - from) * RATE); index += 1) {
      if (index >= 0 && index < length) voice[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / RATE);
    }
  }
  const band = (frequency: number) => {
    const out = new Float32Array(length);
    for (let index = 0; index < length; index += 1) out[index] = 0.1 * Math.sin((2 * Math.PI * frequency * index) / RATE);
    return out;
  };
  const pair = (channel: Float32Array): [Float32Array, Float32Array] => [channel, channel.slice()];
  return {
    implementation: 'test-stems',
    sampleRate: RATE,
    startMs: Math.round(from * 1000),
    endMs: Math.round(to * 1000),
    stems: { vocals: pair(voice), drums: pair(band(90)), bass: pair(band(55)), other: pair(band(440)) },
  };
}

/** A sings six lines ending at 83.5 s of a 100 s song; B starts singing at 30 s. */
const A_LINES: Array<[number, number]> = Array.from({ length: 6 }, (_, line) => [60 + line * 4, 63.5 + line * 4]);
const B_LINES: Array<[number, number]> = [[30, 33.5], [34, 37.5]];
const A_STEMS = stemSet(40, 100, A_LINES);
const B_STEMS = stemSet(0, 45, B_LINES);

const ABLE: SeamAbilities = {
  beatmatch: { ok: true },
  eqFilters: { ok: true },
  stretch: { ok: true },
  stems: { ok: true },
  echo: { ok: true },
};

const reading = (overrides: Partial<StemReading> = {}): StemReading => ({
  read: async (_song, window) => (window === 'tail' ? A_STEMS : B_STEMS),
  allowed: () => ['auto', 'bass_swap_blend', 'vocal_ride', 'stem_arrange', 'stem_intertwine'],
  preference: () => 'sometimes',
  history: () => [],
  ...overrides,
});

const stretchInPlace = (channels: Float32Array[], sampleRate: number, ramp: { ratio: number; holdSeconds: number; rampSeconds: number }) => {
  const result = timeStretch(channels, sampleRate, rampCurve(ramp));
  if (result.status !== 'ready') throw new Error(result.reason);
  return result.channels;
};

const seam = (move: string, a = track(120), b = track(120), abilities = ABLE, stems = reading(), indexes = { fromIndex: 0, toIndex: 1 }): Promise<SeamSchedule> => {
  const normal = scriptSeam({ a, b, move: 'auto', abilities });
  return withStemMove({ ...indexes, a, b, move, normal, abilities, stems, stretch: stretchInPlace });
};

describe('stem moves in a seam', () => {
  it('plays an explicit vocal ride from the cached stems, with its own words and length', async () => {
    const asked: string[] = [];
    const schedule = await seam('vocal_ride', track(120), track(120), ABLE, reading({
      read: async (song, window) => {
        asked.push(`${song}:${window}`);
        return window === 'tail' ? A_STEMS : B_STEMS;
      },
    }));
    expect(asked).toEqual(['0:tail', '1:head']);
    expect(schedule.style).toBe('vocal_ride');
    expect(schedule.degraded).toBeUndefined();
    const plan = schedule.stems!.plan;
    expect(schedule.bars).toBe(plan.bars);
    expect(schedule.why).toBe(plan.why);
    expect(schedule.startSeconds).toBe(plan.startSeconds);
    // B's full mix enters exactly at the plan's handover, A's mix leaves into its stems
    const start = schedule.events.find((event) => event.deck === 'b' && event.kind === 'start')!;
    expect(start).toEqual({ deck: 'b', kind: 'start', at: plan.handoverToNative.startAt, sourceAt: plan.handoverToNative.bSourceAt });
    expect(schedule.events.filter((event) => event.deck === 'a' && event.kind === 'gain').map((event) => event.value)).toEqual([1, 0]);
    // every stem the plan plays is there, and covers its layer
    const { buffers } = schedule.stems!;
    for (const layer of plan.layers) {
      const channels = (layer.side === 'a' ? buffers!.a : buffers!.b).stems[layer.stem]!;
      const offset = layer.side === 'a' ? layer.sourceFrom - buffers!.a.origin : layer.from - buffers!.b.at;
      expect(offset).toBeGreaterThanOrEqual(-1e-6);
      expect(channels[0].length / RATE).toBeGreaterThanOrEqual(offset + layer.until - layer.from - 1e-3);
    }
    expect(stemsFirstAt(plan)).toBeLessThan(plan.startSeconds);
    // a record keeps the plan, never the audio
    expect(recordable(schedule).stems).toEqual({ plan });
  });

  it('stretches B’s stems onto A’s bars when the tempos differ, or refuses without a stretch', async () => {
    const stretched = await seam('vocal_ride', track(120), track(121.2));
    expect(stretched.style).toBe('vocal_ride');
    const { plan, buffers } = stretched.stems!;
    expect(plan.bSourcePerSecond).toBeCloseTo(120 / 121.2, 9);
    // B's drums play in A's time: the stretched buffer is longer than the B audio it covers
    const drums = plan.layers.find((layer) => layer.side === 'b' && layer.stem === 'drums')!;
    const span = drums.until - drums.from;
    expect(buffers!.b.stems.drums![0].length / RATE).toBeGreaterThan(span);

    const flat = await seam('vocal_ride', track(120), track(121.2), { ...ABLE, stretch: { ok: false, reason: 'the stretch is not loaded on this device' } });
    expect(flat.stems).toBeUndefined();
    expect(flat.degraded?.at(-1)).toMatchObject({ wanted: 'vocal_ride', instead: flat.style });
    expect(flat.degraded?.at(-1)?.reason).toBe("Vocal ride needs a time-stretch to follow the first song’s bars, which this device can’t run: the stretch is not loaded on this device.");
  });

  it('says the stems were not ready when the cache has none, and plays the normal move', async () => {
    const missing = reading({ read: async (_song, window) => (window === 'tail' ? A_STEMS : null) });
    const explicit = await seam('vocal_ride', track(120), track(120), ABLE, missing);
    expect(explicit.stems).toBeUndefined();
    expect(explicit.style).toBe('bass_swap_blend');
    expect(explicit.degraded?.at(-1)).toEqual({ wanted: 'vocal_ride', instead: 'bass_swap_blend', reason: 'The stems weren’t ready in time.' });
    const auto = await seam('auto', track(120), track(120), ABLE, missing);
    expect(auto.degraded?.at(-1)).toEqual({ wanted: 'stems', instead: 'bass_swap_blend', reason: 'The stems weren’t ready in time.' });
    // auto that would not have weighed stems stays quiet
    expect((await seam('auto', track(120), track(120), ABLE, reading({ ...missing, preference: () => 'never' }))).degraded).toBeUndefined();
    expect((await seam('auto', track(120), track(120), { ...ABLE, stems: { ok: false, reason: 'no splitter' } }, missing)).degraded).toBeUndefined();
    // an explicit stem move on a device that can't split says so
    const unable = await seam('stem_arrange', track(120), track(120), { ...ABLE, stems: { ok: false, reason: 'this device has no WebGPU' } });
    expect(unable.degraded?.at(-1)).toMatchObject({ wanted: 'stem_arrange', reason: 'this device has no WebGPU' });
  });

  it('turns a recipe’s refusal into the member’s words, and plays the normal move', async () => {
    const refused = await seam('stem_intertwine', track(120), track(124));
    expect(refused.stems).toBeUndefined();
    const reason = refused.degraded?.at(-1)?.reason ?? '';
    expect(reason).toMatch(/^Intertwined stems needs two songs closer in tempo\. The songs are 3\.2 percent apart in tempo/);
    expect(refusalCode('Nobody is singing near the end of the first song, so there\'s no voice to ride.')).toBe('voice');
    expect(refusalCode('The first song\'s beat isn\'t steady enough for a vocal ride.')).toBe('grid');
    expect(refusalCode('There isn\'t room for 16 bars of both songs.')).toBe('room');
  });

  it('lets stem moves compete with the normal move under local mode’s weights, quietly', async () => {
    const styles = new Set<string>();
    for (let fromIndex = 0; fromIndex < 24; fromIndex += 1) {
      const schedule = await seam('auto', track(120), track(120), ABLE, reading(), { fromIndex, toIndex: fromIndex + 1 });
      styles.add(schedule.style ?? '');
      expect(schedule.degraded).toBeUndefined();
    }
    expect(styles.has('bass_swap_blend')).toBe(true);
    expect([...styles].some((style) => style.startsWith('vocal_ride') || style.startsWith('stem_'))).toBe(true);
    expect(NORMAL_MOVE_WEIGHTS.bass_swap_blend).toBe(2.5);
    // the same seam always draws the same move
    const again = await seam('auto', track(120), track(120), ABLE, reading(), { fromIndex: 3, toIndex: 4 });
    expect((await seam('auto', track(120), track(120), ABLE, reading(), { fromIndex: 3, toIndex: 4 })).style).toBe(again.style);
  });
});

describe('the worker seam provider with stems', () => {
  const NOW = 1_700_000_000_000;
  const evidence: WorkerBudgetEvidence = {
    calibration: { implementation: WORKER_CALIBRATION_IMPLEMENTATION, deviceId: 'stems-test', calibratedAt: NOW, samples: 3, msPerBlock: 10, horizonS: 30 },
    deviceId: 'stems-test', atFloor: false, deadlineMisses: 0,
  };
  const roster = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: evidence, now: NOW });
  const song = (seconds: number): PcmLike => ({ sampleRate: RATE, duration: seconds, numberOfChannels: 1, getChannelData: () => new Float32Array(seconds * RATE) });

  it('plays the named stem move and records it without its audio', async () => {
    const records: SeamRecord[] = [];
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'vocal_ride' }),
      abilities: () => ({ ...abilitiesFrom((feature) => roster.get(feature)), stems: { ok: true }, echo: { ok: true } }),
      timing: () => track(120),
      calibration: evidence.calibration,
      deviceId: 'stems-test',
      now: () => NOW,
      workerFactory: () => { throw new Error('the injected analysis needs no worker'); },
      stems: reading({ songId: (index) => 100 + index }),
      onPlanned: (record) => records.push(record),
    });
    const schedule = await provider({ fromIndex: 0, from: song(100), toIndex: 1, to: song(100) });
    expect(schedule.style).toBe('vocal_ride');
    expect(schedule.stems?.buffers).toBeDefined();
    expect(records[0].schedule.stems).toEqual({ plan: schedule.stems!.plan });
    provider.dispose();
  });
});
