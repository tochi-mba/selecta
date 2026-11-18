import { describe, expect, it } from 'vitest';
import { buildGraph } from '../engine/graph';
import { createScheduler, LoadedTrack, SeamProvider } from '../engine/scheduler';
import { createEngineStore } from '../engine/state';
import { bufferOfSeconds, FakeAudioContext, FakeAudioParam, FakeNode, manualTimers, settle } from '../engine/testAudio';
import { applyMoves, BAND_FLOOR_DB, bandDb, canMakeMoves, HIGH_SPLIT_HZ, LOW_SPLIT_HZ, makeMovesChain } from './seamMoves';
import { scriptSeam } from './seamScript';
import type { TrackTiming } from './seams';

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

class MovesContext extends FakeAudioContext {
  readonly biquads: FakeBiquad[] = [];
  createBiquadFilter() {
    const made = new FakeBiquad();
    this.biquads.push(made);
    return made;
  }
}

const asContext = (context: FakeAudioContext) => context as unknown as BaseAudioContext;

describe('the seam move chain', () => {
  it('maps band gains to shelf decibels with a floor', () => {
    expect(bandDb(1)).toBe(0);
    expect(bandDb(0)).toBe(BAND_FLOOR_DB);
    expect(bandDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('starts neutral: 0 dB shelves at the reference split points, open filters', () => {
    const context = new MovesContext();
    expect(canMakeMoves(asContext(context))).toBe(true);
    expect(canMakeMoves(asContext(new FakeAudioContext()))).toBe(false);
    const chain = makeMovesChain(asContext(context));
    const [low, mid, high, highpass, lowpass] = context.biquads;
    expect([low.type, low.frequency.value, low.gain.value]).toEqual(['lowshelf', LOW_SPLIT_HZ, 0]);
    expect([high.type, high.frequency.value]).toEqual(['highshelf', HIGH_SPLIT_HZ]);
    expect(mid.gain.value).toBe(0);
    expect([highpass.type, highpass.frequency.value]).toEqual(['highpass', 0]);
    expect([lowpass.type, lowpass.frequency.value]).toEqual(['lowpass', context.sampleRate / 2]);
    expect(chain.input).toBe(low);
    expect(chain.output).toBe(lowpass);
  });

  it('writes eq and filter events on the chain, offset by base, and reopens the filter after', () => {
    const context = new MovesContext();
    const chain = makeMovesChain(asContext(context));
    applyMoves(chain, [
      { deck: 'a', kind: 'eq', band: 'low', at: 10, value: 1 },
      { deck: 'a', kind: 'eq', band: 'low', at: 11, value: 0 },
      { deck: 'a', kind: 'filter', filter: 'highpass', at: 10, hz: 30 },
      { deck: 'a', kind: 'filter', filter: 'highpass', at: 18, hz: 2000 },
    ], 5, 22050);
    const [low, , , highpass] = context.biquads;
    expect(low.gain.events).toEqual([{ type: 'set', value: 0, at: 15 }, { type: 'ramp', value: BAND_FLOOR_DB, at: 16 }]);
    expect(highpass.frequency.events).toEqual([
      { type: 'set', value: 30, at: 15 },
      { type: 'ramp', value: 2000, at: 23 },
      { type: 'set', value: 0, at: 23.05 },
    ]);
  });
});

function timing(bpm: number): TrackTiming {
  const period = 60 / bpm;
  return { beats: Array.from({ length: 400 }, (_, beat) => beat * period), tempo: { bpm, confidence: 0.9, ambiguous: false }, durationSeconds: 60 };
}

describe('the scheduler plays scripted moves', () => {
  it('routes each layer through the chain and applies both decks\' moves', async () => {
    const context = new MovesContext();
    const graph = buildGraph(asContext(context));
    const store = createEngineStore();
    const timers = manualTimers();
    const seam: SeamProvider = () => scriptSeam({
      a: timing(120), b: timing(120), move: 'filter_sweep', bars: 4, exitBar: 20,
      abilities: { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: false, reason: 'x' }, stems: { ok: false, reason: 'x' }, echo: { ok: false, reason: 'x' } },
    });
    const scheduler = createScheduler({
      graph, store, timers, seam,
      load: async (index): Promise<LoadedTrack> => (index < 2 ? { kind: 'buffer', buffer: bufferOfSeconds(60) as unknown as AudioBuffer } : { kind: 'missing' }),
      hold: async () => { await context.suspend(); },
      wake: async () => { await context.resume(); return true; },
    });
    await scheduler.start(0, 0, true);
    context.advance(20); // the next song is now inside LOAD_NEXT_WITHIN
    timers.tick();
    await settle();
    expect(scheduler.lastTransition()).toMatchObject({ kind: 'seam_schedule', seamKind: 'beatmatch' });
    // two layers, five biquads each; the first song's source feeds its chain, not its gain
    expect(context.biquads).toHaveLength(10);
    expect(context.madeSources[0].connections[0]).toBe(context.biquads[0]);
    const aHighpass = context.biquads[3];
    const bLowpass = context.biquads[9];
    const base = 0.05; // the first song started at the start lead
    expect(aHighpass.frequency.events[0]).toEqual({ type: 'set', value: 30, at: expect.closeTo(base + 40, 6) });
    expect(aHighpass.frequency.events[1]).toEqual({ type: 'ramp', value: 2000, at: expect.closeTo(base + 48, 6) });
    expect(bLowpass.frequency.events[0]).toMatchObject({ type: 'set', value: 300 });
    expect(context.madeSources[1].started[0].when).toBeCloseTo(base + 40, 6);
  });
});
