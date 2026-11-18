import { describe, expect, it } from 'vitest';
import { FALLBACK_FADE_SECONDS } from './crossfade';
import { LEAVE_AFTER_SECONDS, MAX_WINDOW_SECONDS, type SeamEvent, type TrackTiming } from './seams';
import {
  barsThatFit,
  BLEND_FADE_SHARE,
  CUT_DECLICK_SECONDS,
  scriptSeam,
  SEAM_SCRIPT_IMPLEMENTATION,
  type SeamAbilities,
} from './seamScript';
import { SEAM_MOVES_IMPLEMENTATION } from './seamMoves';

function track(bpm: number, confidence = 0.9, ambiguous = false, duration = 180): TrackTiming {
  const period = 60 / bpm;
  const beats = Array.from({ length: Math.floor(duration / period) }, (_, beat) => beat * period);
  return { beats, tempo: { bpm, confidence, ambiguous }, durationSeconds: duration };
}

const ALL: SeamAbilities = {
  beatmatch: { ok: true },
  eqFilters: { ok: true },
  stretch: { ok: false, reason: 'no vetted pitch-preserving stretch is bundled' },
  stems: { ok: false, reason: 'stems are not available in the browser' },
  echo: { ok: false, reason: 'the echo and wash returns are not built for the browser yet' },
};

const of = (events: SeamEvent[], deck: 'a' | 'b', kind: SeamEvent['kind']) =>
  events.filter((event) => event.deck === deck && event.kind === kind);

describe('the browser seam script', () => {
  it('plays bass_swap_blend: one low end at a time, traded on a bar line across one beat', () => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'bass_swap_blend', bars: 4, exitBar: 20, abilities: ALL });
    expect(schedule.kind).toBe('beatmatch');
    expect(schedule.style).toBe('bass_swap_blend');
    expect(schedule.implementation).toContain(SEAM_SCRIPT_IMPLEMENTATION);
    expect(schedule.implementation).toContain(SEAM_MOVES_IMPLEMENTATION);
    expect(schedule.startSeconds).toBeCloseTo(40, 6); // bar 20 at 120 BPM
    expect(schedule.windowSeconds).toBeCloseTo(8, 6); // 4 bars
    const aLow = of(schedule.events, 'a', 'eq');
    const bLow = of(schedule.events, 'b', 'eq');
    // the swap lands on bar 2 of 4 (round(4 * 0.5)), 4 s in, across one 0.5 s beat
    expect(aLow.map((event) => [event.at, event.value])).toEqual([[43.75, 1], [44.25, 0]]);
    expect(bLow.at(0)?.value).toBe(0);
    expect(bLow.at(-1)).toMatchObject({ at: 44.25, value: 1 });
    // gains cross over 65 percent of the overlap at each end, as the reference recipe does
    const bGain = of(schedule.events, 'b', 'gain');
    expect(bGain.at(-1)?.at).toBeCloseTo(40 + 8 * BLEND_FADE_SHARE, 6);
    const aGain = of(schedule.events, 'a', 'gain');
    expect(aGain[0].at).toBeCloseTo(48 - 8 * BLEND_FADE_SHARE, 6);
    expect(of(schedule.events, 'a', 'stop')[0].at).toBeGreaterThan(48);
    expect(schedule.degraded).toBeUndefined();
  });

  it('plays filter_sweep: A highpasses 30 Hz to 2 kHz while B opens from 300 Hz to 20 kHz', () => {
    const schedule = scriptSeam({ a: track(124), b: track(124), move: 'filter_sweep', bars: 4, exitBar: 20, abilities: ALL });
    const filters = schedule.events.filter((event) => event.kind === 'filter');
    expect(filters.filter((event) => event.deck === 'a').map((event) => [event.filter, event.hz])).toEqual([['highpass', 30], ['highpass', 2000]]);
    expect(filters.filter((event) => event.deck === 'b').map((event) => [event.filter, event.hz])).toEqual([['lowpass', 300], ['lowpass', 20000]]);
  });

  it('degrades EQ moves to the plain blend, labelled, when the device has no move chain', () => {
    const schedule = scriptSeam({
      a: track(120), b: track(120), move: 'bass_swap_blend', exitBar: 20,
      abilities: { ...ALL, eqFilters: { ok: false, reason: 'this device has no EQ or filters' } },
    });
    expect(schedule.kind).toBe('beatmatch');
    expect(schedule.events.some((event) => event.kind === 'eq')).toBe(false);
    expect(schedule.degraded).toContainEqual({ wanted: 'eq', instead: 'blend', reason: 'this device has no EQ or filters' });
  });

  it('keeps the window bounded, saying so when the asked-for bars do not fit', () => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'bass_swap_blend', bars: 16, exitBar: 20, abilities: ALL });
    expect(schedule.windowSeconds).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
    expect(schedule.degraded?.[0]).toMatchObject({ wanted: '16 bars', instead: '8 bars' });
    expect(schedule.degraded?.[0].reason).toContain('at most');
  });

  it('without a stretch, shortens the overlap until the beats drift at most an eighth of a beat', () => {
    expect(barsThatFit(16, 0.5, 0)).toBe(8);
    expect(barsThatFit(8, 0.5, 0.01)).toBe(2); // 0.125 / (4 * 0.01) = 3.1 bars
    const schedule = scriptSeam({ a: track(120), b: track(121.2), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: ALL });
    expect(schedule.windowSeconds).toBeCloseTo(4, 6);
    expect(schedule.degraded?.[0].reason).toContain('time-stretch');
  });

  it('falls back to a labelled fade when the tempos are too far apart for any overlap', () => {
    const schedule = scriptSeam({ a: track(120), b: track(128), move: 'filter_sweep', exitBar: 20, abilities: ALL });
    expect(schedule.kind).toBe('fade');
    expect(schedule.windowSeconds).toBe(FALLBACK_FADE_SECONDS);
    expect(schedule.degraded).toContainEqual(expect.objectContaining({ wanted: 'stretch', instead: 'fade' }));
  });

  it.each([
    ['tempo_ramp', 'stretch'],
    ['echo_out', 'echo'],
    ['reverb_wash', 'wash'],
    ['delay_throw', 'stems'],
  ])('degrades %s, which needs %s, to a labelled fade', (move, wanted) => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move, exitBar: 20, abilities: ALL });
    expect(schedule.kind).toBe('fade');
    expect(schedule.style).toBe(move);
    expect(schedule.degraded?.[0]).toMatchObject({ wanted, instead: 'fade' });
    expect(schedule.reason).toContain(`no ${move}`);
  });

  it('cuts on the one with the reference declick', () => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'cut_on_one', exitBar: 20, entryBar: 4, abilities: ALL });
    const start = of(schedule.events, 'b', 'start')[0];
    expect(start.at).toBeCloseTo(40 - CUT_DECLICK_SECONDS, 9);
    expect(start.sourceAt).toBeCloseTo(8 - CUT_DECLICK_SECONDS, 9);
    expect(of(schedule.events, 'a', 'gain').at(-1)).toMatchObject({ value: 0 });
    expect(of(schedule.events, 'a', 'gain').at(-1)?.at).toBeCloseTo(40 + CUT_DECLICK_SECONDS, 9);
  });

  it('refuses a beatmatch on low or ambiguous confidence, or without the capability', () => {
    expect(scriptSeam({ a: track(120, 0.2), b: track(120), move: 'bass_swap_blend', abilities: ALL }).kind).toBe('fade');
    expect(scriptSeam({ a: track(120), b: track(120, 0.9, true), abilities: ALL }).reason).toContain('ambiguous');
    const unmeasured = scriptSeam({ a: track(120), b: track(120), abilities: { ...ALL, beatmatch: { ok: false, reason: 'not measured' } } });
    expect(unmeasured.kind).toBe('fade');
    expect(unmeasured.degraded?.[0]).toMatchObject({ wanted: 'beatmatch', reason: 'not measured' });
  });

  it('honours leave_after for every move, and defaults the exit near the end of the song', () => {
    for (const move of ['blend', 'bass_swap_blend', 'cut_on_one', 'echo_out']) {
      const schedule = scriptSeam({ a: track(120), b: track(120), move, exitBar: 2, abilities: ALL });
      expect(schedule.startSeconds).toBeGreaterThanOrEqual(LEAVE_AFTER_SECONDS - CUT_DECLICK_SECONDS);
    }
    const late = scriptSeam({ a: track(120), b: track(120), move: 'blend', bars: 4, abilities: ALL });
    expect(late.startSeconds + late.windowSeconds).toBeLessThanOrEqual(180);
    expect(late.startSeconds).toBeGreaterThan(160);
  });

  it('labels an unknown move instead of guessing at it', () => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'spinback', abilities: ALL });
    expect(schedule.degraded?.[0]).toMatchObject({ wanted: 'spinback', instead: 'blend' });
  });

  it('ends every overlap inside the outgoing song, shortening or fading when it is short', () => {
    const short = scriptSeam({ a: track(120, 0.9, false, 40), b: track(120), move: 'bass_swap_blend', bars: 8, abilities: ALL });
    expect(short.startSeconds + short.windowSeconds).toBeLessThan(40);
    expect(short.startSeconds).toBeGreaterThanOrEqual(LEAVE_AFTER_SECONDS);
    expect(short.degraded?.[0]).toMatchObject({ wanted: '8 bars', instead: '4 bars' });
    expect(short.degraded?.[0].reason).toContain('settle rule');
    const tiny = scriptSeam({ a: track(120, 0.9, false, 32), b: track(120), move: 'bass_swap_blend', abilities: ALL });
    expect(tiny.kind).toBe('fade');
    expect(tiny.degraded?.[0]).toMatchObject({ wanted: 'overlap', instead: 'fade' });
  });
});
