import { describe, expect, it, vi } from 'vitest';
import type { RenderedClip, SeamSchedule } from '../dsp/seams';
import { buildGraph } from './graph';
import { createScheduler, type LoadedTrack, type SeamProvider } from './scheduler';
import { createEngineStore } from './state';
import { FakeAudioBuffer, FakeAudioContext, manualTimers, settle } from './testAudio';

// A song that comes with the level it must play at (cloud.studio_seams: a cloud song next to a
// clip made in the cloud) plays at exactly that gain, never a measured one, so the clip's joins
// meet it without a step; a song without one is measured as before.

const RATE = 44_100;

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

function clip(levels: { a: number; b: number }): RenderedClip {
  const length = 12 * RATE + 3;
  return {
    channels: [new Float32Array(length), new Float32Array(length)], sampleRate: RATE,
    aStartSample: 40 * RATE, bEndSample: 3 * RATE, levels, switchAt: 6,
    bWarp: { output: [0, length / RATE], source: [3 - length / RATE, 3] }, implementation: 'cloud-studio-1',
  };
}

const asSchedule = (rendered: RenderedClip): SeamSchedule => ({
  implementation: rendered.implementation, kind: 'beatmatch', startSeconds: rendered.aStartSample / RATE,
  windowSeconds: rendered.channels[0].length / RATE, events: [{ deck: 'b', kind: 'start', at: 1, sourceAt: 0 }],
  rendered, chosenBy: { by: 'cloud' },
});

function rig(given: (number | undefined)[], provide: SeamProvider, measured = 0.3) {
  const context = contextAt(RATE);
  const graph = buildGraph(context as unknown as BaseAudioContext);
  const timers = manualTimers();
  const buffers = [new FakeAudioBuffer(2, 60 * RATE, RATE), new FakeAudioBuffer(2, 50 * RATE, RATE)];
  const level = vi.fn(async () => measured);
  const asks: { fromLevel?: number; toLevel?: number }[] = [];
  const scheduler = createScheduler({
    graph, store: createEngineStore(), timers,
    load: async (index): Promise<LoadedTrack> => (buffers[index]
      ? { kind: 'buffer', buffer: buffers[index] as unknown as AudioBuffer, ...(given[index] !== undefined ? { level: given[index] } : {}) }
      : { kind: 'missing' }),
    hold: async () => { await context.suspend(); },
    wake: async () => { await context.resume(); return true; },
    seam: (request) => { asks.push({ fromLevel: request.fromLevel, toLevel: request.toLevel }); return provide(request); },
    planAhead: () => true,
    level,
  });
  const planned = async () => {
    await scheduler.start(0, 0, true);
    context.advance(2);
    timers.tick();
    await settle();
  };
  return { context, scheduler, planned, level, asks };
}

const gains = (context: FakeAudioContext) => context.madeGains.map((gain) => gain.gain.value);

describe('a song with a level of its own', () => {
  it('plays at exactly that gain, and the clip made at it plays between the two songs', async () => {
    const a = 10 ** (-4.25 / 20);
    const b = 10 ** (-1.5 / 20);
    const { context, scheduler, planned, level, asks } = rig([a, b], () => asSchedule(clip({ a, b })));
    await planned();
    // nothing measured: the given levels are the ones played and the ones the seam is asked at
    expect(level).not.toHaveBeenCalled();
    expect(asks[0]).toEqual({ fromLevel: a, toLevel: b });
    expect(gains(context)).toEqual(expect.arrayContaining([a, b]));
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', implementation: 'cloud-studio-1' });
  });

  it('refuses a clip made at another level than the song plays at, saying why', async () => {
    const { scheduler, planned } = rig([0.5, 0.8], () => asSchedule(clip({ a: 0.5, b: 0.7 })));
    await planned();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/another level/) });
  });

  it('is measured as before when it has none, and an unusable one is ignored', async () => {
    const { context, planned, level, asks } = rig([undefined, Number.NaN], () => null, 0.3);
    await planned();
    expect(level).toHaveBeenCalledTimes(2);
    expect(asks[0]).toEqual({ fromLevel: 0.3, toLevel: 0.3 });
    expect(gains(context)).toContain(0.3);
  });
});
