import { describe, expect, it } from 'vitest';
import { scheduleSeam, type RenderedClip, type SeamSchedule } from '../dsp/seams';
import { buildGraph } from './graph';
import { joinSamples } from './renderedSeam';
import { createScheduler, type LoadedTrack, type SeamProvider } from './scheduler';
import { createEngineStore } from './state';
import { FakeAudioBuffer, FakeAudioContext, manualTimers, settle } from './testAudio';

// The scheduler's third seam kind: native A, a clip rendered ahead, native B, joined on whole
// samples from A's origin with in_context's 30 ms linear crossfades, at the levels the songs play.
// The other two kinds keep their own tests in scheduler.test.ts and schedulerStems.test.ts.

/** A context that can hold a clip in memory, at a chosen rate. */
function contextAt(rate: number) {
  const context = new FakeAudioContext();
  context.sampleRate = rate;
  Object.assign(context, {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const buffer = Object.assign(new FakeAudioBuffer(channels, length, sampleRate), {
        copyToChannel(data: Float32Array, channel: number) { buffer.data[channel].set(data); },
      });
      return buffer;
    },
  });
  return context;
}

/** A clip of `seconds` from A's `aStart` into B's `bEnd` (seconds), silent like the fake songs. */
function clip(rate: number, aStart: number, bEnd: number, seconds: number, levels = { a: 1, b: 1 }): RenderedClip {
  const length = Math.round(seconds * rate) + 3;
  return {
    channels: [new Float32Array(length), new Float32Array(length)], sampleRate: rate,
    aStartSample: Math.round(aStart * rate), bEndSample: Math.round(bEnd * rate), levels, switchAt: seconds / 2,
    bWarp: { output: [0, length / rate], source: [bEnd - length / rate, bEnd] }, implementation: 'web-render-1+wsola-stretch-v1',
  };
}

const asSchedule = (rendered: RenderedClip, instead?: SeamSchedule): SeamSchedule => ({
  implementation: rendered.implementation, kind: 'beatmatch', startSeconds: rendered.aStartSample / rendered.sampleRate,
  windowSeconds: rendered.channels[0].length / rendered.sampleRate, events: [{ deck: 'b', kind: 'start', at: 1, sourceAt: 0 }],
  rendered, instead, chosenBy: { by: 'account-rendered' },
});

function rig(rate: number, provide: (request: Parameters<SeamProvider>[0]) => SeamSchedule | null, levels: number[] = [1, 1]) {
  const context = contextAt(rate);
  const graph = buildGraph(context as unknown as BaseAudioContext);
  const store = createEngineStore();
  const timers = manualTimers();
  const buffers = [new FakeAudioBuffer(2, 60 * rate, rate), new FakeAudioBuffer(2, 50 * rate, rate)];
  const scheduler = createScheduler({
    graph, store, timers,
    load: async (index): Promise<LoadedTrack> => (buffers[index] ? { kind: 'buffer', buffer: buffers[index] as unknown as AudioBuffer } : { kind: 'missing' }),
    hold: async () => { await context.suspend(); },
    wake: async () => { await context.resume(); return true; },
    seam: provide,
    planAhead: () => true,
    level: async (buffer) => levels[buffers.indexOf(buffer as unknown as FakeAudioBuffer)] ?? 1,
  });
  const planned = async () => {
    await scheduler.start(0, 0, true);
    context.advance(2);
    timers.tick();
    await settle();
  };
  return { context, scheduler, planned };
}

type Gain = FakeAudioContext['madeGains'][number];
const last = (gain: Gain) => gain.events.slice(-2);

describe('a clip rendered ahead', () => {
  for (const rate of [44_100, 48_000]) {
    it(`plays between native A and native B on whole samples at ${rate} Hz`, async () => {
      const made = clip(rate, 40, 3, 12);
      const { context, scheduler, planned } = rig(rate, (request) => (request.fromIndex === 0 ? asSchedule(made) : null));
      await planned();
      expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', implementation: made.implementation });
      const [a, b, played] = context.madeSources;
      const seam = joinSamples(rate);
      const length = made.channels[0].length;
      // A started at 0.05 from its sample 0, so its origin is 0.05
      const clipAt = 0.05 + made.aStartSample / rate;
      const tailAt = clipAt + (length - seam) / rate;
      expect(played.started).toEqual([{ when: clipAt, offset: undefined, duration: undefined }]);
      expect(b.started).toEqual([{ when: tailAt, offset: (made.bEndSample - seam) / rate, duration: undefined }]);
      expect(a.stopped).toContain(clipAt + seam / rate + 0.02);
      // the clip's own fader: in over the first join, out over the last
      const clipGain = context.madeGains.find((gain) => gain.connections.length && gain.events.length === 4 && gain.events[0].value === 0)!;
      expect(clipGain.events).toEqual([
        { type: 'set', value: 0, at: clipAt },
        { type: 'ramp', value: 1, at: clipAt + (seam - 1) / rate },
        { type: 'set', value: 1, at: tailAt },
        { type: 'ramp', value: 0, at: tailAt + (seam - 1) / rate },
      ]);
      // A out and B in over the same joins, linear, 1 on the first sample and 0 on the last
      const faders = context.madeGains.filter((gain) => gain !== clipGain && gain.events.length >= 2);
      expect(faders.map(last)).toEqual(expect.arrayContaining([
        [{ type: 'set', value: 1, at: clipAt }, { type: 'ramp', value: 0, at: clipAt + (seam - 1) / rate }],
        [{ type: 'set', value: 0, at: tailAt }, { type: 'ramp', value: 1, at: tailAt + (seam - 1) / rate }],
      ]));
      // the hand-over the surfaces follow: B is "now playing" from the clip's switch point
      const next = scheduler.clock?.()?.next;
      expect(next?.index).toBe(1);
      expect(next?.at).toBeCloseTo(made.aStartSample / rate + made.switchAt, 9);
    });
  }

  it('plays the native songs at the levels the clip was made at, and the clip past them', async () => {
    const made = clip(44_100, 40, 3, 12, { a: 0.5, b: 0.8 });
    const { context, scheduler, planned } = rig(44_100, (request) => (request.fromIndex === 0 ? asSchedule(made) : null), [0.5, 0.8]);
    await planned();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule' });
    const levelled = context.madeGains.filter((gain) => gain.gain.value === 0.5 || gain.gain.value === 0.8).map((gain) => gain.gain.value);
    expect(levelled).toEqual(expect.arrayContaining([0.5, 0.8]));
    const played = context.madeSources[2];
    const clipGain = played.connections[0] as Gain;
    // straight to the deck: through no level gain of its own
    expect(clipGain.connections).toHaveLength(1);
    expect(levelled).not.toContain(clipGain.gain.value);
  });

  it('gives way to the live plan it carries when the songs play at other levels, saying why', async () => {
    const made = clip(44_100, 40, 3, 12, { a: 1, b: 1 });
    const live = scheduleSeam(
      { beats: Array.from({ length: 100 }, (_, index) => index * 0.5), tempo: { bpm: 120, confidence: 0.9, ambiguous: false }, durationSeconds: 60 },
      { beats: Array.from({ length: 100 }, (_, index) => index * 0.5), tempo: { bpm: 120, confidence: 0.9, ambiguous: false }, durationSeconds: 50 },
      { exitSeconds: 44, entrySeconds: 1, windowSeconds: 8 },
    );
    const { context, scheduler, planned } = rig(44_100, (request) => (request.fromIndex === 0 ? asSchedule(made, live) : null), [1, 0.5]);
    await planned();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', implementation: live.implementation });
    expect(context.madeSources).toHaveLength(2);
  });

  it('falls back to today\'s fade, with the reason, when there is no live plan to give way to', async () => {
    const made = clip(44_100, 40, 3, 12);
    made.channels[0][100] = Number.POSITIVE_INFINITY;
    const { scheduler, planned } = rig(44_100, (request) => (request.fromIndex === 0 ? asSchedule(made) : null));
    await planned();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/not sound/) });
  });

  it('is refused when its start has already gone by', async () => {
    const made = clip(44_100, 1, 3, 12);
    const { scheduler, planned } = rig(44_100, (request) => (request.fromIndex === 0 ? asSchedule(made) : null));
    await planned();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/too late/) });
  });

  it('fades out with the rest on a stop, and is silenced with its layer', async () => {
    const made = clip(44_100, 40, 3, 12);
    const { context, scheduler, planned } = rig(44_100, (request) => (request.fromIndex === 0 ? asSchedule(made) : null));
    await planned();
    const played = context.madeSources[2];
    const clipGain = played.connections[0] as Gain;
    context.setState('running');
    scheduler.stop(500);
    expect(clipGain.events.slice(-1)[0]).toMatchObject({ type: 'ramp', value: 0, at: context.currentTime + 0.5 });
    expect(played.stopped.slice(-1)[0]).toBeCloseTo(context.currentTime + 0.52, 9);
  });
});
