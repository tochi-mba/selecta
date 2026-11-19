import { describe, expect, it } from 'vitest';
import type { SeamSchedule, TrackTiming } from '../dsp/seams';
import { scriptSeam, type SeamAbilities } from '../dsp/seamScript';
import { withStemMove } from '../dsp/stemSchedule';
import { warpAt } from '../dsp/stemMoves/types';
import type { StemSet } from '../dsp/stems/cache';
import { buildGraph } from './graph';
import { createScheduler, type LoadedTrack, type SeamProvider } from './scheduler';
import { createEngineStore } from './state';
import { FakeAudioBuffer, FakeAudioContext, FakeAudioParam, FakeBufferSourceNode, FakeGainNode, FakeNode, manualTimers, settle } from './testAudio';

const RATE = 8000;

class Param extends FakeAudioParam {
  exponentialRampToValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push({ type: 'ramp', value, at });
    return this;
  }
}
class FakeBiquad extends FakeNode {
  type = 'lowpass';
  readonly frequency = new Param();
  readonly gain = new Param();
  readonly Q = new Param();
}
class FakeDelay extends FakeNode {
  readonly delayTime = new Param();
}

/** A fake context with everything a stem move needs: buffers, biquads, a delay for the echo. */
class StemsContext extends FakeAudioContext {
  readonly delays: FakeDelay[] = [];
  createBiquadFilter() {
    return new FakeBiquad();
  }
  createDelay() {
    const made = new FakeDelay();
    this.delays.push(made);
    return made;
  }
  createConvolver() {
    return Object.assign(new FakeNode(), { buffer: null, normalize: true });
  }
  createBuffer(channels: number, length: number, rate: number) {
    const buffer = Object.assign(new FakeAudioBuffer(channels, length, rate), {
      copyToChannel(data: Float32Array, channel: number) { buffer.data[channel].set(data); },
    });
    return buffer;
  }
}

function track(bpm: number, duration = 100): TrackTiming {
  const period = 60 / bpm;
  return { beats: Array.from({ length: Math.floor(duration / period) }, (_, beat) => beat * period), tempo: { bpm, confidence: 0.9, ambiguous: false }, durationSeconds: duration };
}

function stemSet(from: number, to: number, lines: Array<[number, number]>): StemSet {
  const length = Math.round((to - from) * RATE);
  const voice = new Float32Array(length);
  for (const [start, end] of lines) {
    for (let index = Math.round((start - from) * RATE); index < Math.round((end - from) * RATE); index += 1) {
      if (index >= 0 && index < length) voice[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / RATE);
    }
  }
  const pair = (channel: Float32Array): [Float32Array, Float32Array] => [channel, channel.slice()];
  return {
    implementation: 'test-stems', sampleRate: RATE, startMs: from * 1000, endMs: to * 1000,
    stems: { vocals: pair(voice), drums: pair(new Float32Array(length)), bass: pair(new Float32Array(length)), other: pair(new Float32Array(length)) },
  };
}

const ABLE: SeamAbilities = { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: true }, stems: { ok: true }, echo: { ok: true } };
const A_STEMS = stemSet(40, 100, Array.from({ length: 6 }, (_, line) => [60 + line * 4, 63.5 + line * 4] as [number, number]));
const B_STEMS = stemSet(0, 45, [[30, 33.5], [34, 37.5]]);

/** A real vocal ride between two 100 s songs at 120 BPM, from the recipe and the cached stems. */
async function ride(): Promise<SeamSchedule> {
  const a = track(120);
  const b = track(120);
  const schedule = await withStemMove({
    fromIndex: 0, toIndex: 1, a, b, move: 'vocal_ride',
    normal: scriptSeam({ a, b, move: 'auto', abilities: ABLE }),
    abilities: ABLE,
    stems: { read: async (_song, window) => (window === 'tail' ? A_STEMS : B_STEMS), allowed: () => ['vocal_ride'], preference: () => 'sometimes', history: () => [] },
    stretch: null,
  });
  if (!schedule.stems) throw new Error(`no ride: ${JSON.stringify(schedule.degraded)}`);
  return schedule;
}

const rig = (seam: SeamProvider, context: FakeAudioContext = new StemsContext()) => {
  const graph = buildGraph(context as unknown as BaseAudioContext);
  const timers = manualTimers();
  const loaded = (index: number): LoadedTrack => (index < 2
    ? { kind: 'buffer', buffer: new FakeAudioBuffer(2, 100 * RATE, RATE) as unknown as AudioBuffer }
    : { kind: 'missing' });
  const scheduler = createScheduler({
    graph,
    store: createEngineStore(),
    load: async (index) => loaded(index),
    hold: async () => { await context.suspend(); },
    wake: async () => { await context.resume(); return true; },
    seam,
    timers,
  });
  return { context, graph, timers, scheduler };
};

/** Start A, come within the planning lead of its end, and let the seam be planned. */
async function planned(seam: SeamProvider, context?: FakeAudioContext) {
  const made = rig(seam, context);
  await made.scheduler.start(0, 0, true);
  made.context.advance(56);
  made.timers.tick();
  await settle();
  return { ...made, base: made.context.madeSources[0].started[0].when };
}

describe('a stem move on the scheduler', () => {
  it('plays every stem on its own chain, hands A’s mix to its stems and B’s stems to B’s mix', async () => {
    const schedule = await ride();
    const { plan } = schedule.stems!;
    const { context, graph, scheduler, base } = await planned((request) => (request.fromIndex === 0 ? schedule : null));
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', seamKind: 'beatmatch' });
    const [a, native, ...voices] = context.madeSources as FakeBufferSourceNode[];
    expect(voices).toHaveLength(plan.layers.length);
    plan.layers.forEach((layer, index) => {
      const voice = voices[index];
      expect(voice.started[0].when).toBeCloseTo(base + layer.from, 9);
      expect(voice.stopped[0]).toBeCloseTo(base + layer.until, 9);
      // A's stems are A's own audio at A's time; B's sit on A's timeline already
      const buffers = schedule.stems!.buffers!;
      const offset = layer.side === 'a' ? layer.sourceFrom - buffers.a.origin : layer.from - buffers.b.at;
      expect(voice.started[0].offset).toBeCloseTo(offset, 9);
      // each stem's fader goes to its own song's deck, past every native fader
      let node: unknown = voice.connections[0];
      while (!(node instanceof FakeGainNode)) node = (node as FakeNode).connections[0];
      expect((node as FakeGainNode).connections).toContain(layer.side === 'a' ? graph.deckA : graph.deckB);
    });
    // B's full mix enters at the handover, A's leaves into its stems
    const handover = plan.handoverToNative;
    expect(native.started[0]).toEqual({ when: expect.closeTo(base + handover.startAt, 9), offset: expect.closeTo(handover.bSourceAt, 9), duration: undefined });
    expect(a.stopped[0]).toBeCloseTo(base + plan.native.a.at(-1)![0] + 1e-6 + 0.02, 6);
    // A's last word goes into an in-time echo
    expect((context as StemsContext).delays).toHaveLength(1);
    expect((context as StemsContext).delays[0].delayTime.value).toBeCloseTo(plan.echo!.delaySeconds, 9);
  });

  it('keeps song time exact through the stems and after the handover to B’s own audio', async () => {
    const schedule = await ride();
    const { plan } = schedule.stems!;
    const { context, timers, scheduler, base } = await planned((request) => (request.fromIndex === 0 ? schedule : null));
    const during = plan.startSeconds + 4;
    context.advance(base + during - context.currentTime);
    timers.tick();
    expect(scheduler.position()).toEqual({ index: 1, offsetMs: Math.round(warpAt(plan.bWarp, during) * 1000), paused: false });
    const handover = plan.handoverToNative;
    context.advance(base + handover.at + 2 - context.currentTime);
    timers.tick();
    expect(scheduler.position()?.offsetMs).toBe(Math.round((handover.bSourceAt + (handover.at + 2 - handover.startAt)) * 1000));
  });

  it('silences every stem with a stop, and tears them down when B’s own audio ends', async () => {
    const schedule = await ride();
    const stopped = await planned((request) => (request.fromIndex === 0 ? schedule : null));
    const voices = (stopped.context.madeSources as FakeBufferSourceNode[]).slice(2);
    stopped.scheduler.stop(0);
    for (const voice of voices) {
      expect(voice.stopped.length).toBeGreaterThan(1);
      expect(voice.connections).toHaveLength(0);
    }

    const ended = await planned((request) => (request.fromIndex === 0 ? schedule : null));
    const [, native, ...rest] = ended.context.madeSources as FakeBufferSourceNode[];
    rest[0].end();
    expect(native.connections).toHaveLength(1);
    native.end();
    for (const voice of rest) expect(voice.connections).toHaveLength(0);

    const faded = await planned((request) => (request.fromIndex === 0 ? schedule : null));
    faded.scheduler.stop(500);
    const voiceGain = (faded.context.madeSources[2] as FakeBufferSourceNode).connections;
    expect(voiceGain.length).toBeGreaterThan(0);
  });

  it('falls back to a fade with the reason when the stems are missing or the device can’t shape them', async () => {
    const schedule = await ride();
    const bare = await planned((request) => (request.fromIndex === 0 ? { ...schedule, stems: { plan: schedule.stems!.plan } } : null));
    expect(bare.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: 'the stems for this transition were not prepared' });
    expect(bare.context.madeSources).toHaveLength(2);
    const plain = await planned((request) => (request.fromIndex === 0 ? schedule : null), new FakeAudioContext());
    expect(plain.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/this device cannot (shape the stems|make)/) });
    const late = await planned((request) => (request.fromIndex === 0 ? { ...schedule, stems: { ...schedule.stems!, plan: { ...schedule.stems!.plan, handoverToNative: { ...schedule.stems!.plan.handoverToNative, bSourceAt: 99 } } } } : null));
    expect(late.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/hands over somewhere other/) });
  });
});
