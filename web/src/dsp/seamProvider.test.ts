import { describe, expect, it } from 'vitest';
import { CapabilityRegistry, registerBrowserDspCapabilities } from './capability';
import { abilitiesFrom, abilityOf, analyseTiming, beatGrid, calibrateAnalysis, CLIP_CONTEXT_SECONDS, gridSupport, makeSeamProvider, makeWorkerSeamProvider, MIN_ANALYSE_SECONDS, MIN_PULSE, pulseStrength, sliceMono, type PcmLike, type SeamRecord } from './seamProvider';
import { rampSourceSeconds } from './stretchLimits';
import { MIN_BEATMATCH_CONFIDENCE } from './seams';
import type { SeamSchedule, TrackTiming } from './seams';
import { analyse } from './workers/analysisWorker';
import { WORKER_CALIBRATION_IMPLEMENTATION, type WorkerBudgetEvidence } from './budget';

const TEST_NOW = 1_700_000_000_000;
const TEST_DEVICE = 'seam-provider-test-device';
function workerEvidence(horizonS = 30): WorkerBudgetEvidence {
  return {
    calibration: {
      implementation: WORKER_CALIBRATION_IMPLEMENTATION,
      deviceId: TEST_DEVICE,
      calibratedAt: TEST_NOW,
      samples: 3,
      msPerBlock: 10,
      horizonS,
    },
    deviceId: TEST_DEVICE,
    atFloor: false,
    deadlineMisses: 0,
  };
}

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

const ready = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(), now: TEST_NOW });
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

  it('never trusts a tempo on a steady tone: no pulse, no beatmatch', () => {
    const sampleRate = 22050;
    const pcm = new Float32Array(40 * sampleRate).map((_, index) => 0.2 * Math.sin(2 * Math.PI * 220 * index / sampleRate));
    expect(pulseStrength(pcm)).toBeLessThan(MIN_PULSE);
    const tone = analyseTiming({ sampleRate, duration: 40, numberOfChannels: 1, getChannelData: () => pcm }, 'tail');
    expect(tone.tempo.confidence).toBeLessThan(MIN_BEATMATCH_CONFIDENCE);
    expect(pulseStrength(clicks(120, 10).getChannelData(0))).toBeGreaterThan(MIN_PULSE);
  });

  it('measures how far onsets bear out a grid', () => {
    expect(gridSupport([1, 2, 3, 4], [1.01, 2.02, 3.5], 0, 10)).toBe(0.5);
    expect(gridSupport([1, 2], [], 0, 10)).toBe(0);
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

  it('keeps Tier 2 on a labelled fade without fresh matching calibration and never creates a worker', async () => {
    let created = 0;
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'beatmatch' }),
      abilities: () => abilitiesFrom(status),
      calibration: { ...workerEvidence().calibration, deviceId: 'another-device' },
      deviceId: TEST_DEVICE,
      now: () => TEST_NOW,
      workerFactory: () => { created += 1; throw new Error('worker must not start without valid evidence'); },
    });
    const song = clicks(120, 90);
    const schedule = await provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(created).toBe(0);
    expect(schedule.kind).toBe('fade');
    expect(schedule.reason).toMatch(/different device/);
    expect(schedule.degraded?.[0]).toMatchObject({ wanted: 'beatmatch', instead: 'fade' });
  });

  it('shrinks the following worker analysis window after a calibrated deadline miss', async () => {
    let now = TEST_NOW;
    const latencies = [20, 0, 0];
    const pcmLengths: number[] = [];
    const states: Array<{ supported: boolean; deadlineMisses: number; horizonS?: number }> = [];
    const workerFactory = () => {
      const listeners = new Map<string, (event: MessageEvent) => void>();
      return {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.set(type, listener as (event: MessageEvent) => void);
        },
        removeEventListener: (type: string) => { listeners.delete(type); },
        postMessage: (request: { id: number; pcm: Float32Array }) => {
          pcmLengths.push(request.pcm.length);
          now += latencies.shift() ?? 0;
          queueMicrotask(() => listeners.get('message')?.({
            data: {
              id: request.id,
              tempo: { implementation: 'test-tempo', bpm: 120, confidence: 0.9, ambiguous: false },
              onsetTimes: [],
            },
          } as MessageEvent));
        },
        terminate: () => { listeners.clear(); },
      } as unknown as Worker;
    };
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({}),
      abilities: () => abilitiesFrom(status),
      calibration: workerEvidence().calibration,
      deviceId: TEST_DEVICE,
      now: () => now,
      workerFactory,
      onBudgetState: (state) => states.push(state),
    });
    const song = clicks(120, 90);
    const first = await provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(first.kind).toBe('fade');
    expect(states.some((state) => state.deadlineMisses === 1 && state.horizonS === 15)).toBe(true);
    expect(pcmLengths[0]).toBe(60 * song.sampleRate);

    await provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(pcmLengths[1]).toBe(30 * song.sampleRate);
    provider.dispose();
  });

  it('keeps a confident beat when the slice is transferred to the worker and emptied on this side', async () => {
    const workerFactory = () => {
      const listeners = new Map<string, (event: MessageEvent) => void>();
      return {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.set(type, listener as (event: MessageEvent) => void);
        },
        removeEventListener: (type: string) => { listeners.delete(type); },
        postMessage: (request: { id: number; pcm: Float32Array; sampleRate: number }, transfer?: Transferable[]) => {
          // as a browser does: the transferred buffer is detached here, so the page's slice is empty
          const sent = structuredClone(request.pcm, { transfer: (transfer ?? []) as Transferable[] });
          expect(request.pcm.length).toBe(0);
          const response = analyse({ id: request.id, sampleRate: request.sampleRate, pcm: sent, tasks: ['onsets', 'tempo'] });
          queueMicrotask(() => listeners.get('message')?.({ data: response } as MessageEvent));
        },
        terminate: () => { listeners.clear(); },
      } as unknown as Worker;
    };
    const planned: SeamSchedule[] = [];
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'blend' }), abilities: () => abilitiesFrom(status), calibration: workerEvidence().calibration,
      deviceId: TEST_DEVICE, now: () => TEST_NOW, workerFactory, onPlanned: (record) => planned.push(record.schedule),
    });
    const song = clicks(120, 90);
    const schedule = await provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(schedule.kind).toBe('beatmatch');
    provider.dispose();
  });

  it('never shrinks the analysis below the slice a beat grid needs', async () => {
    let now = TEST_NOW;
    const pcmLengths: number[] = [];
    const workerFactory = () => {
      const listeners = new Map<string, (event: MessageEvent) => void>();
      return {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.set(type, listener as (event: MessageEvent) => void);
        },
        removeEventListener: (type: string) => { listeners.delete(type); },
        postMessage: (request: { id: number; pcm: Float32Array }) => {
          pcmLengths.push(request.pcm.length);
          queueMicrotask(() => listeners.get('message')?.({
            data: { id: request.id, tempo: { implementation: 'test-tempo', bpm: 120, confidence: 0.9, ambiguous: false }, onsetTimes: [] },
          } as MessageEvent));
        },
        terminate: () => { listeners.clear(); },
      } as unknown as Worker;
    };
    // a budget already shrunk to its 5 s floor
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({}), abilities: () => abilitiesFrom(status), calibration: { ...workerEvidence().calibration!, horizonS: 6 },
      deviceId: TEST_DEVICE, now: () => now, workerFactory,
    });
    const song = clicks(120, 90);
    await provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(pcmLengths[0]).toBe(MIN_ANALYSE_SECONDS * song.sampleRate);
    now += 1;
    provider.dispose();
  });
});

describe('stretched entries', () => {
  const STRETCHY = () => ({ ...abilitiesFrom(status), stretch: { ok: true as const } });
  const headAndTail = (part: 'head' | 'tail') => timing(part === 'tail' ? 120 : 121.2);

  it('renders B’s entry stretched along the schedule’s ramp, and keeps the clip out of the record', () => {
    const records: SeamRecord[] = [];
    const provider = makeSeamProvider({
      settingsFor: () => ({ move: 'bass_swap_blend', bars: 8, exit_bar: 20 }),
      abilities: STRETCHY,
      timing: (_buffer, part) => headAndTail(part),
      onPlanned: (record) => records.push(record),
    });
    const song = clicks(120, 120);
    const schedule = provider({ fromIndex: 0, from: song, toIndex: 1, to: song });
    const stretch = schedule.stretch!;
    expect(stretch.ratio).toBeCloseTo(120 / 121.2, 9);
    const clip = stretch.clip!;
    expect(clip.sampleRate).toBe(song.sampleRate);
    // B enters on its first beat (0 s), so there is no lead-in to skip
    expect(clip.skipSeconds).toBe(0);
    const ramp = { ratio: stretch.ratio, holdSeconds: stretch.holdUntil - schedule.startSeconds, rampSeconds: stretch.rampUntil - stretch.holdUntil };
    const inputSeconds = stretch.handoverSourceAt + CLIP_CONTEXT_SECONDS - stretch.sourceFrom;
    expect(Math.abs(rampSourceSeconds(ramp, clip.channels[0].length / clip.sampleRate) - inputSeconds) * clip.sampleRate).toBeLessThan(2);
    expect(records[0].schedule.stretch).not.toHaveProperty('clip');
    expect(records[0].schedule.stretch?.ratio).toBe(stretch.ratio);
  });

  it('goes without the stretch, and says so, when the clip cannot be rendered', () => {
    const records: SeamRecord[] = [];
    const provider = makeSeamProvider({
      settingsFor: () => ({ move: 'bass_swap_blend', bars: 8, exit_bar: 20 }),
      abilities: STRETCHY,
      timing: (_buffer, part) => headAndTail(part),
      onPlanned: (record) => records.push(record),
    });
    // the analysis says two minutes, but only ten seconds of B decoded: the clip comes back short
    const short = clicks(120, 10);
    const schedule = provider({ fromIndex: 0, from: short, toIndex: 1, to: short });
    expect(schedule.stretch).toBeUndefined();
    expect(schedule.kind).toBe('beatmatch');
    expect(schedule.windowSeconds).toBeCloseTo(4, 6);
    expect(schedule.degraded?.at(-1)).toEqual({ wanted: 'stretch', instead: 'unstretched', reason: 'the stretch could not be prepared: the stretched audio came back too short' });
    expect(records[0].schedule).toBe(schedule);
  });

  it('renders off-thread in the worker provider, and falls back when the stretch worker misses its deadline', async () => {
    const answering = (onsetsFor: (call: number) => number[]) => {
      let call = 0;
      return () => {
        const listeners = new Map<string, (event: MessageEvent) => void>();
        return {
          addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
            if (typeof listener === 'function') listeners.set(type, listener as (event: MessageEvent) => void);
          },
          removeEventListener: (type: string) => { listeners.delete(type); },
          postMessage: (request: { id: number }) => {
            const onsetTimes = onsetsFor(call);
            const bpm = call === 0 ? 120 : 121.2;
            call += 1;
            queueMicrotask(() => listeners.get('message')?.({
              data: { id: request.id, tempo: { implementation: 'test-tempo', bpm, confidence: 0.9, ambiguous: false }, onsetTimes },
            } as MessageEvent));
          },
          terminate: () => { listeners.clear(); },
        } as unknown as Worker;
      };
    };
    const grid = (bpm: number, offset: number) => Array.from({ length: Math.floor((60 * bpm) / 60) }, (_, beat) => beat * (60 / bpm) + offset);
    const song = clicks(120, 120, 22050, 0);
    const stretchers: string[] = [];
    let silent = true;
    const stretchWorkerFactory = () => {
      const listeners = new Map<string, (event: MessageEvent) => void>();
      return {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.set(type, listener as (event: MessageEvent) => void);
        },
        removeEventListener: (type: string) => { listeners.delete(type); },
        postMessage: (request: { id: number; channels: Float32Array[] }) => {
          stretchers.push('asked');
          if (silent) return;
          queueMicrotask(() => listeners.get('message')?.({ data: { id: request.id, channels: request.channels.map(() => new Float32Array(30 * 22050)) } } as MessageEvent));
        },
        terminate: () => { stretchers.push('terminated'); },
      } as unknown as Worker;
    };
    const make = () => makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'bass_swap_blend', bars: 8, exit_bar: 20 }),
      abilities: STRETCHY,
      calibration: workerEvidence().calibration,
      deviceId: TEST_DEVICE,
      now: () => TEST_NOW,
      workerFactory: answering((call) => (call % 2 === 0 ? grid(120, 0) : grid(121.2, 0))),
      stretchWorkerFactory,
      stretchTimeoutMs: 5,
    });
    const late = make();
    const fallen = await late({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(stretchers).toEqual(['asked', 'terminated']);
    expect(fallen.stretch).toBeUndefined();
    expect(fallen.degraded?.at(-1)?.reason).toMatch(/^the stretch could not be prepared: the stretch took longer than/);
    late.dispose();

    silent = false;
    const prompt = make();
    const stretched = await prompt({ fromIndex: 0, from: song, toIndex: 1, to: song });
    expect(stretched.stretch?.clip?.channels[0]).toHaveLength(30 * 22050);
    prompt.dispose();
    expect(stretchers.at(-1)).toBe('terminated');
  });
});
