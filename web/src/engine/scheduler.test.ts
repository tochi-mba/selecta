import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { createScheduler, END_FADE, LoadedTrack, SEAM_FADE } from './scheduler';
import { createEngineStore } from './state';
import { bufferOfSeconds, FakeAudioContext, manualTimers, settle } from './testAudio';

/** A scheduler over fakes: tracks[index] seconds each, 'failed' for a bad file, the end past
 * the list. With delayLoads every load waits until the test releases it in call order. */
const rig = (tracks: (number | 'failed')[], options: { delayLoads?: boolean } = {}) => {
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
    hold: () => context.suspend(),
    wake: async () => {
      await context.resume();
      return true;
    },
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
    expect(nextGain.events).toEqual([
      { type: 'set', value: 0, at: expect.closeTo(seamAt, 5) },
      { type: 'ramp', value: 1, at: expect.closeTo(seamAt + SEAM_FADE, 5) },
    ]);
    expect(first.stopped[0]).toBeCloseTo(seamAt + SEAM_FADE + 0.02, 5);
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
    expect(nextGain.events[1]).toEqual({
      type: 'ramp',
      value: 1,
      at: expect.closeTo(context.currentTime + 0.05 + END_FADE, 5),
    });
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
