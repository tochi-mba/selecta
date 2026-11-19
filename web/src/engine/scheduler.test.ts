import { describe, expect, it } from 'vitest';
import { equalPowerIn } from '../dsp/crossfade';
import { scheduleSeam, SeamSchedule, type SeamStretch } from '../dsp/seams';
import { rampSourceSeconds } from '../dsp/stretchLimits';
import { buildGraph } from './graph';
import { createScheduler, END_FADE, LoadedTrack, SEAM_FADE, SeamProvider } from './scheduler';
import { createEngineStore } from './state';
import { bufferOfSeconds, FakeAudioBuffer, FakeAudioContext, manualTimers, settle } from './testAudio';

/** A scheduler over fakes: tracks[index] seconds each, 'failed' for a bad file, the end past
 * the list. With delayLoads every load waits until the test releases it in call order. */
const rig = (
  tracks: (number | 'failed')[],
  options: { delayLoads?: boolean; seam?: SeamProvider; holdDelay?: () => Promise<void> } = {},
) => {
  const context = new FakeAudioContext();
  const graph = buildGraph(context as unknown as BaseAudioContext);
  const store = createEngineStore();
  const timers = manualTimers();
  const pending: (() => void)[] = [];
  const loaded = (index: number): LoadedTrack => {
    const seconds = tracks[index];
    if (seconds === undefined) return { kind: 'missing' };
    if (seconds === 'failed') return { kind: 'failed', error: 'bad file' };
    return { kind: 'buffer', buffer: bufferOfSeconds(seconds) as unknown as AudioBuffer };
  };
  const scheduler = createScheduler({
    graph,
    store,
    load: (index) => (options.delayLoads
      ? new Promise((settled) => pending.push(() => settled(loaded(index))))
      : Promise.resolve(loaded(index))),
    hold: async () => {
      await options.holdDelay?.();
      await context.suspend();
    },
    wake: async () => {
      await context.resume();
      return true;
    },
    seam: options.seam,
    timers,
  });
  return { context, graph, store, timers, scheduler, pending };
};

describe('starting', () => {
  it('schedules the song at its offset on the audio clock', async () => {
    const { context, scheduler, store } = rig([10]);
    await scheduler.start(0, 2500, true);
    const source = context.madeSources[0];
    expect(source.started).toEqual([{ when: 0.05, offset: 2.5, duration: undefined }]);
    expect(store.get().phase).toBe('playing');
  });

  it('never schedules twice: only the newest start speaks, even when a stale load lands late', async () => {
    const { context, scheduler, pending } = rig([10, 6], { delayLoads: true });
    void scheduler.start(0, 0, true);
    await settle();
    void scheduler.start(1, 0, true);
    await settle();
    // the first start's load answers now, after it has lost ownership, then the second's
    pending.shift()?.();
    await settle();
    pending.shift()?.();
    await settle();
    expect(context.madeSources).toHaveLength(1);
    expect(context.madeSources[0].buffer?.duration).toBe(6);
  });

  it('skips a failed song with a notice instead of playing silence', async () => {
    const { context, scheduler, store } = rig(['failed', 8]);
    await scheduler.start(0, 0, true);
    expect(store.get().notice).toMatch(/skipped/);
    expect(store.get().phase).toBe('playing');
    expect(context.madeSources).toHaveLength(1);
    expect(context.madeSources[0].buffer?.duration).toBe(8);
  });

  it('comes to rest idle past the end of the list', async () => {
    const { scheduler, store } = rig([5]);
    await scheduler.start(3, 0, true);
    expect(store.get().phase).toBe('idle');
  });

  it('starts paused when asked, holding the context', async () => {
    const { context, scheduler, store } = rig([10]);
    await scheduler.start(0, 1000, false);
    expect(store.get().phase).toBe('paused');
    expect(context.state).toBe('suspended');
    expect(scheduler.position()).toEqual({ index: 0, offsetMs: 1000, paused: true });
  });
});

describe('the tick and the seam', () => {
  it('plans a 30 ms crossfade on the boundary when the next song is ready in time', async () => {
    const { context, scheduler, timers } = rig([10, 7]);
    await scheduler.start(0, 0, true);
    const first = context.madeSources[0];
    const startedAt = first.started[0].when;
    timers.tick(); // a 10 s song is inside LOAD_NEXT_WITHIN from its first moment
    await settle();
    expect(context.madeSources).toHaveLength(2);
    const next = context.madeSources[1];
    const seamAt = startedAt + 10 - SEAM_FADE;
    expect(next.started[0].when).toBeCloseTo(seamAt, 5);
    const nextGain = context.madeGains.at(-1)!;
    // Equal-power, not linear: silent just before the seam, full at its end, sin() between.
    expect(nextGain.events[0]).toEqual({ type: 'set', value: 0, at: expect.closeTo(seamAt, 5) });
    expect(nextGain.events.at(-1)).toEqual({ type: 'ramp', value: expect.closeTo(1, 9), at: expect.closeTo(seamAt + SEAM_FADE, 5) });
    const quarter = nextGain.events.find((event) => Math.abs(event.at - (seamAt + SEAM_FADE / 4)) < 1e-9);
    expect(quarter?.value).toBeCloseTo(equalPowerIn(0.25), 9);
    expect(first.stopped[0]).toBeCloseTo(seamAt + SEAM_FADE + 0.02, 5);
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'boundary', implementation: 'equal-power-crossfade-v1' });
  });

  it('fades the next song in rather than leaving a gap when it decodes too late', async () => {
    const { context, scheduler, timers, pending } = rig([10, 7], { delayLoads: true });
    void scheduler.start(0, 0, true);
    await settle();
    pending.shift()?.(); // the current song's own load
    await settle();
    timers.tick();
    await settle();
    // the next song's decode only answers once the boundary has already passed
    context.advance(10.5);
    pending.shift()?.();
    await settle();
    const next = context.madeSources[1];
    expect(next.started[0].when).toBeCloseTo(context.currentTime + 0.05, 5);
    const nextGain = context.madeGains.at(-1)!;
    expect(nextGain.events.at(-1)).toEqual({
      type: 'ramp',
      value: expect.closeTo(1, 9),
      at: expect.closeTo(context.currentTime + 0.05 + END_FADE, 5),
    });
    expect(scheduler.lastTransition()?.kind).toBe('late_fade');
  });

  it('becomes the next song once the seam passes, and ends idle after the last', async () => {
    const { context, scheduler, timers, store } = rig([10, 7]);
    await scheduler.start(0, 0, true);
    timers.tick();
    await settle();
    context.advance(10.1); // past the planned seam
    timers.tick();
    expect(scheduler.position()?.index).toBe(1);
    await settle(); // that tick also looked ahead and found the end of the list
    context.advance(8); // past the last song's end
    timers.tick();
    expect(store.get().phase).toBe('idle');
    expect(scheduler.position()).toBeNull();
  });
});

describe('position truth', () => {
  it('follows the audio clock while playing and freezes through a pause', async () => {
    const { context, scheduler } = rig([30]);
    await scheduler.start(0, 1000, true);
    context.advance(0.05); // the start lead
    context.advance(2);
    expect(scheduler.position()).toEqual({ index: 0, offsetMs: 3000, paused: false });
    await scheduler.pause();
    // suspend freezes the context clock, so the position holds without bookkeeping
    expect(scheduler.position()).toEqual({ index: 0, offsetMs: 3000, paused: true });
    await scheduler.resume();
    expect(scheduler.position()?.paused).toBe(false);
  });

  it('answers null when idle, after stop, and after dispose', async () => {
    const { scheduler } = rig([10]);
    expect(scheduler.position()).toBeNull();
    await scheduler.start(0, 0, true);
    scheduler.stop(0);
    expect(scheduler.position()).toBeNull();
    await scheduler.start(0, 0, true);
    scheduler.dispose();
    expect(scheduler.position()).toBeNull();
    expect(scheduler.playing()).toBe(false);
  });
});

describe('stopping', () => {
  it('fades out over the asked time and forgets the songs at once', async () => {
    const { context, scheduler, store } = rig([10]);
    await scheduler.start(0, 0, true);
    scheduler.stop(1000);
    const faded = context.madeGains.at(-1)!;
    expect(faded.events.at(-1)).toEqual({ type: 'ramp', value: 0, at: expect.closeTo(context.currentTime + 1, 5) });
    expect(context.madeSources[0].stopped.at(-1)).toBeCloseTo(context.currentTime + 1.02, 5);
    expect(scheduler.position()).toBeNull();
    expect(store.get().phase).toBe('idle');
  });

  it('cuts at once when the context is suspended, so nothing lingers for a later resume', async () => {
    const { context, scheduler } = rig([10]);
    await scheduler.start(0, 0, false); // paused, context suspended
    scheduler.stop(1000);
    expect(context.madeSources[0].stopped).toHaveLength(1); // stopped now, not on a fade
    expect(scheduler.position()).toBeNull();
  });
});

/** A confident beat grid at 120 bpm over the whole song. */
const grid = (seconds: number) => ({
  beats: Array.from({ length: Math.floor(seconds * 2) }, (_, beat) => beat / 2),
  tempo: { bpm: 120, confidence: 0.9, ambiguous: false },
  durationSeconds: seconds,
});

describe('seam schedules from dsp/seams.ts', () => {
  it('consumes a beatmatched schedule: entry, equal-power gains on both decks and the exit stop', async () => {
    const asked: { fromIndex: number; toIndex: number }[] = [];
    const made: SeamSchedule[] = [];
    const seam: SeamProvider = (request) => {
      asked.push({ fromIndex: request.fromIndex, toIndex: request.toIndex });
      const schedule = scheduleSeam(grid(request.from.duration), grid(request.to.duration), { exitSeconds: 40, entrySeconds: 2, windowSeconds: 8 });
      made.push(schedule);
      return schedule;
    };
    const { context, scheduler, timers } = rig([60, 50], { seam });
    await scheduler.start(0, 0, true);
    context.advance(20); // the next song is now inside LOAD_NEXT_WITHIN
    timers.tick();
    await settle();
    expect(asked).toEqual([{ fromIndex: 0, toIndex: 1 }]);
    expect(made[0].kind).toBe('beatmatch');
    const base = context.madeSources[0].started[0].when; // song A's 0 s on the context clock
    const next = context.madeSources[1];
    expect(next.started[0]).toEqual({ when: expect.closeTo(base + 40, 9), offset: 2, duration: undefined });
    // The outgoing gain follows the schedule's equal-power fall and stops after the window.
    const outgoing = context.madeGains[context.madeGains.length - 2];
    const falls = outgoing.events.filter((event) => event.type === 'ramp');
    expect(falls.at(-1)).toEqual({ type: 'ramp', value: 0, at: expect.closeTo(base + 48, 5) });
    expect(context.madeSources[0].stopped[0]).toBeCloseTo(base + 48 + 0.02, 4);
    const incoming = context.madeGains.at(-1)!;
    expect(incoming.events.at(-1)?.value).toBeCloseTo(1, 9);
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', seamKind: 'beatmatch' });
    // Promotion happens at the seam's entry, with position inside song B from its entry point.
    context.advance(base + 41 - context.currentTime);
    timers.tick();
    expect(scheduler.position()).toEqual({ index: 1, offsetMs: 3000, paused: false });
  });

  it('carries a low-confidence schedule as its own 3 s fade, reason intact', async () => {
    const seam: SeamProvider = (request) => scheduleSeam(
      { ...grid(request.from.duration), tempo: { bpm: 120, confidence: 0.1, ambiguous: false } },
      grid(request.to.duration),
      { exitSeconds: 40 },
    );
    const { context, scheduler, timers } = rig([60, 50], { seam });
    await scheduler.start(0, 0, true);
    context.advance(20); // the next song is now inside LOAD_NEXT_WITHIN
    timers.tick();
    await settle();
    const base = context.madeSources[0].started[0].when;
    expect(context.madeSources[1].started[0].when).toBeCloseTo(base + 40, 9);
    expect(context.madeGains.at(-1)!.events.at(-1)?.at).toBeCloseTo(base + 40 + END_FADE, 5);
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', seamKind: 'fade', reason: expect.stringMatching(/confidence/) });
  });

  it('falls back to a 3 s equal-power fade into the end when the provider has no schedule', async () => {
    const { context, scheduler, timers } = rig([60, 50], { seam: () => null });
    await scheduler.start(0, 0, true);
    context.advance(20); // the next song is now inside LOAD_NEXT_WITHIN
    timers.tick();
    await settle();
    const endAt = context.madeSources[0].started[0].when + 60;
    expect(context.madeSources[1].started[0].when).toBeCloseTo(endAt - END_FADE, 9);
    expect(context.madeGains.at(-1)!.events.at(-1)?.at).toBeCloseTo(endAt, 5);
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/no seam/) });
  });

  it('refuses a schedule whose start has already passed and fades instead, never a double schedule', async () => {
    const { context, scheduler, timers } = rig([60, 50], {
      seam: (request) => scheduleSeam(grid(request.from.duration), grid(request.to.duration), { exitSeconds: 30 }),
    });
    await scheduler.start(0, 0, true);
    context.advance(35); // past the scheduled exit at 30 s
    timers.tick();
    await settle();
    expect(context.madeSources).toHaveLength(2);
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/too late/) });
    timers.tick();
    await settle();
    expect(context.madeSources).toHaveLength(2);
  });

  it('a provider that throws becomes a named fallback, not a crash', async () => {
    const { context, scheduler, timers } = rig([60, 50], { seam: () => { throw new Error('analysis missing'); } });
    await scheduler.start(0, 0, true);
    context.advance(20); // the next song is now inside LOAD_NEXT_WITHIN
    timers.tick();
    await settle();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/analysis missing/) });
  });
});

describe('a stretched entry (in_context: native A, the clip, native B)', () => {
  const RATIO = 0.98;
  const stretchFor = (withClip = true): SeamStretch => {
    const ramp = { ratio: RATIO, holdSeconds: 8, rampSeconds: 4 };
    const inputSeconds = rampSourceSeconds(ramp, 12);
    return {
      ratio: RATIO, holdUntil: 48, rampUntil: 52, sourceFrom: 2, inputSeconds, handoverAt: 52, handoverSourceAt: 2 + inputSeconds,
      ...(withClip ? { clip: { channels: [new Float32Array(Math.round(12.2 * 44100)), new Float32Array(Math.round(12.2 * 44100))], sampleRate: 44100, skipSeconds: 0.05 } } : {}),
    };
  };
  const stretched = (stretch: SeamStretch): SeamProvider => (request) => (request.fromIndex === 0
    ? { ...scheduleSeam(grid(request.from.duration), grid(request.to.duration), { exitSeconds: 40, entrySeconds: 2, windowSeconds: 8 }), stretch }
    : null);
  const withBuffers = (context: FakeAudioContext) => {
    const made: FakeAudioBuffer[] = [];
    Object.assign(context, {
      createBuffer: (channels: number, length: number, rate: number) => {
        const buffer = Object.assign(new FakeAudioBuffer(channels, length, rate), {
          copyToChannel(data: Float32Array, channel: number) { buffer.data[channel].set(data); },
        });
        made.push(buffer);
        return buffer;
      },
    });
    return made;
  };
  type Gain = FakeAudioContext['madeGains'][number];

  it('plays the clip from the seam, hands over to native B with a 30 ms crossfade, and keeps song time exact', async () => {
    const asked: number[] = [];
    const seam: SeamProvider = (request) => {
      asked.push(request.from.duration);
      return stretched(stretchFor())(request);
    };
    const { context, scheduler, timers } = rig([60, 50, 40], { seam });
    const buffers = withBuffers(context);
    await scheduler.start(0, 0, true);
    context.advance(20);
    timers.tick();
    await settle();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', seamKind: 'beatmatch' });
    const base = context.madeSources[0].started[0].when;
    const [, native, clip] = context.madeSources;
    expect(buffers).toHaveLength(1);
    expect(clip.buffer).toBe(buffers[0]);
    expect(native.buffer?.duration).toBe(50);
    expect(clip.started[0]).toEqual({ when: expect.closeTo(base + 40, 9), offset: 0.05, duration: undefined });
    expect(clip.stopped[0]).toBeCloseTo(base + 52 + 0.02, 9);
    const handoverSourceAt = stretchFor().handoverSourceAt;
    expect(native.started[0]).toEqual({ when: expect.closeTo(base + 52 - SEAM_FADE, 9), offset: expect.closeTo(handoverSourceAt - SEAM_FADE, 9), duration: undefined });
    // both feed B's fader: the clip fades out as native B fades in, over the same 30 ms
    const hand = native.connections[0] as Gain;
    const clipGain = clip.connections[0] as Gain;
    expect(hand.connections[0]).toBe(clipGain.connections[0]);
    expect(hand.events.at(-1)).toEqual({ type: 'ramp', value: 1, at: expect.closeTo(base + 52, 9) });
    expect(hand.events.at(-2)).toEqual({ type: 'set', value: 0, at: expect.closeTo(base + 52 - SEAM_FADE, 9) });
    expect(clipGain.events.at(-1)).toEqual({ type: 'ramp', value: 0, at: expect.closeTo(base + 52, 9) });
    // song time follows the clip while it plays, then native B's own clock
    context.advance(base + 44 - context.currentTime);
    timers.tick();
    expect(scheduler.position()).toEqual({ index: 1, offsetMs: Math.round((2 + RATIO * 4) * 1000), paused: false });
    context.advance(base + 50 - context.currentTime);
    timers.tick();
    const easing = 2 + rampSourceSeconds({ ratio: RATIO, holdSeconds: 8, rampSeconds: 4 }, 10);
    expect(scheduler.position()?.offsetMs).toBe(Math.round(easing * 1000));
    context.advance(base + 60 - context.currentTime);
    timers.tick();
    await settle();
    expect(scheduler.position()?.offsetMs).toBe(Math.round((handoverSourceAt + 8) * 1000));
    // the next seam analyses native B, never the clip
    expect(asked).toEqual([60, 50]);
  });

  it('tears the whole layer down when native B ends, and a stop silences both sources', async () => {
    const { context, scheduler, timers } = rig([60, 50], { seam: stretched(stretchFor()) });
    withBuffers(context);
    await scheduler.start(0, 0, true);
    context.advance(20);
    timers.tick();
    await settle();
    const [, native, clip] = context.madeSources;
    scheduler.stop(0);
    expect(native.stopped.length).toBeGreaterThan(0);
    expect(clip.stopped.length).toBeGreaterThan(1);
    expect(clip.connections).toHaveLength(0);

    const again = rig([60, 50], { seam: stretched(stretchFor()) });
    withBuffers(again.context);
    await again.scheduler.start(0, 0, true);
    again.context.advance(20);
    again.timers.tick();
    await settle();
    const [, nativeAgain, clipAgain] = again.context.madeSources;
    clipAgain.end();
    expect(nativeAgain.connections).toHaveLength(1); // the clip ending alone leaves B playing
    nativeAgain.end();
    expect(clipAgain.connections).toHaveLength(0);
    expect(nativeAgain.connections).toHaveLength(0);
  });

  it('falls back to a fade, with the reason, when the clip is missing, cannot become audio, or would not line up', async () => {
    const planned = async (seam: SeamProvider, buffers = true) => {
      const made = rig([60, 50], { seam });
      if (buffers) withBuffers(made.context);
      await made.scheduler.start(0, 0, true);
      made.context.advance(20);
      made.timers.tick();
      await settle();
      return made;
    };
    const missing = await planned(stretched(stretchFor(false)));
    expect(missing.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: 'the stretched entry was not prepared' });
    const noBuffers = await planned(stretched(stretchFor()), false);
    expect(noBuffers.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/could not be loaded into audio/) });
    expect(noBuffers.context.madeSources).toHaveLength(2);
    const off = stretchFor();
    const jumpy = await planned(stretched({ ...off, handoverSourceAt: off.handoverSourceAt + 0.5, inputSeconds: off.inputSeconds + 0.5 }));
    expect(jumpy.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/would not line up/) });
    const wide = await planned(stretched({ ...off, ratio: 1.2 }));
    expect(wide.scheduler.lastTransition()).toMatchObject({ kind: 'fallback_fade', reason: expect.stringMatching(/outside its limits/) });
  });
});

describe('pause truth across awaits', () => {
  it('a start paused holds the context before anything is scheduled', async () => {
    const { context, scheduler } = rig([10]);
    const order: string[] = [];
    const suspend = context.suspend.bind(context);
    context.suspend = async () => {
      order.push(`suspend with ${context.madeSources.length} sources`);
      await suspend();
    };
    await scheduler.start(0, 0, false);
    expect(order).toEqual(['suspend with 0 sources']);
  });

  it('a pause asked for while loading wins: the song lands paused', async () => {
    const { scheduler, store, pending, context } = rig([10], { delayLoads: true });
    void scheduler.start(0, 0, true);
    await settle();
    expect(store.get().phase).toBe('loading');
    await scheduler.pause();
    pending.shift()?.();
    await settle(40);
    expect(store.get().phase).toBe('paused');
    expect(context.state).toBe('suspended');
  });

  it('a pause overtaken by a new start does not mark the new song paused', async () => {
    let release: () => void = () => {};
    let delaying = true;
    const { scheduler, store, context } = rig([10, 10], {
      holdDelay: () => (delaying ? new Promise<void>((settled) => { release = settled; }) : Promise.resolve()),
    });
    await scheduler.start(0, 0, true);
    const pausing = scheduler.pause();
    delaying = false;
    const starting = scheduler.start(1, 0, true);
    release();
    await pausing;
    await starting;
    expect(store.get().phase).toBe('playing');
    expect(scheduler.position()?.index).toBe(1);
    // The new start waited for the stale suspend, so the context runs under the new song.
    expect(context.state).toBe('running');
  });
});
