import { describe, expect, it } from 'vitest';
import { FALLBACK_FADE_SECONDS } from './crossfade';
import { LEAVE_AFTER_SECONDS, MAX_WINDOW_SECONDS, type SeamEvent, type TrackTiming } from './seams';
import {
  AUTO_MIN_BARS,
  barsThatFit,
  BLEND_FADE_SHARE,
  echoFor,
  phraseExit,
  PHRASE_BARS,
  washFor,
  CUT_DECLICK_SECONDS,
  scriptSeam,
  SEAM_SCRIPT_IMPLEMENTATION,
  type SeamAbilities,
} from './seamScript';
import { SEAM_EFFECTS_IMPLEMENTATION } from './seamEffects';
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

  it('with the nudge on, locks within 3 percent by speed; otherwise keeps the beats within an eighth', () => {
    expect(barsThatFit(16, 0.5, 0)).toBe(8);
    expect(barsThatFit(8, 0.5, 0.01)).toBe(2); // 0.125 / (4 * 0.01) = 3.1 bars
    const nudged = scriptSeam({ a: track(120), b: track(121.2), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: { ...ALL, varispeed: { ok: true } } });
    expect(nudged.windowSeconds).toBeCloseTo(16, 6);
    expect(nudged.rate?.value).toBeCloseTo(120 / 121.2, 9);
    expect(nudged.degraded).toBeUndefined();
    const far = scriptSeam({ a: track(120), b: track(126), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: { ...ALL, varispeed: { ok: true } } });
    // without the nudge a 1 percent gap still shortens the overlap, as before
    const plain = scriptSeam({ a: track(120), b: track(121.2), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: ALL });
    expect(plain.windowSeconds).toBeCloseTo(4, 6);
    expect(plain.rate).toBeUndefined();
    expect(far.kind).toBe('fade');
    expect(far.rate).toBeUndefined();
    expect(far.degraded?.at(-1)?.reason).toContain('4.8 percent apart');
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

  it('honours leave_after for every move, and defaults the exit to the last phrase line that fits', () => {
    for (const move of ['blend', 'bass_swap_blend', 'cut_on_one', 'echo_out']) {
      const schedule = scriptSeam({ a: track(120), b: track(120), move, exitBar: 2, abilities: ALL });
      expect(schedule.startSeconds).toBeGreaterThanOrEqual(LEAVE_AFTER_SECONDS - CUT_DECLICK_SECONDS);
    }
    const late = scriptSeam({ a: track(120), b: track(120), move: 'blend', bars: 4, abilities: ALL });
    expect(late.startSeconds + late.windowSeconds).toBeLessThanOrEqual(180);
    // 8-bar phrase lines fall every 16 s at 120 BPM; 176 s would leave no room, so 160 s
    expect(late.startSeconds).toBeCloseTo(160, 6);
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

describe('SelectaDJ picking a move in the browser (cloud.browser_moves)', () => {
  const ECHO: SeamAbilities = { ...ALL, echo: { ok: true } };

  it('picks local mode’s first choice, a bass swap blend, when the tempos sit close', () => {
    const schedule = scriptSeam({ a: track(124), b: track(124.1), move: 'auto', abilities: ECHO });
    expect(schedule.style).toBe('bass_swap_blend');
    expect(schedule.bars).toBeGreaterThanOrEqual(AUTO_MIN_BARS);
    expect(schedule.why).toMatch(/^The tempos are 0\.1 percent apart, so both play in time for \d+ bars and trade the bass on a bar line\.$/);
    // a small gap is absorbed by nudging the next song's speed, as local mode lets B absorb it
    // with cloud.browser_varispeed, a small gap is absorbed by nudging the next song's speed
    const nudged = scriptSeam({ a: track(124), b: track(126), move: 'auto', abilities: { ...ECHO, varispeed: { ok: true } } });
    expect(nudged.style).toBe('bass_swap_blend');
    // a browser seam window is at most 16 s, so 8 bars at 124 BPM
    expect(nudged.bars).toBe(8);
    expect(nudged.rate?.value).toBeCloseTo(124 / 126, 9);
    expect(nudged.rate?.holdUntil).toBeCloseTo(nudged.startSeconds + nudged.windowSeconds, 9);
    expect(nudged.rate!.rampUntil - nudged.rate!.holdUntil).toBeCloseTo(16 * 60 / 124, 9);
    expect(nudged.why).toContain('nudge the next song’s speed');
    // beyond 3 percent a nudge would be heard, so it echoes out instead
    expect(scriptSeam({ a: track(124), b: track(130), move: 'auto', abilities: { ...ECHO, varispeed: { ok: true } } }).style).toBe('echo_out');
    // without the nudge (the default, BF-0459-05) even 1.6 percent drifts too far for eight bars
    const plain = scriptSeam({ a: track(124), b: track(126), move: 'auto', abilities: ECHO });
    expect(plain.style).toBe('echo_out');
    expect(plain.rate).toBeUndefined();
  });

  it('never picks a blend shorter than eight bars: a wide tempo gap echoes out instead', () => {
    const schedule = scriptSeam({ a: track(120), b: track(100), move: 'auto', abilities: ECHO });
    expect(schedule.style).toBe('echo_out');
    expect(schedule.why).toContain('this browser can’t stretch them');
    expect(schedule.effects?.echo).toEqual(echoFor(0.5));
    // without the returns the tempo-free move is a cut on the beat
    expect(scriptSeam({ a: track(120), b: track(100), move: 'auto', abilities: ALL }).style).toBe('cut_on_one');
  });

  it('only picks among the moves this account has on, and picks for a named move that is off', () => {
    const noSwap = scriptSeam({ a: track(124), b: track(124), move: 'auto', abilities: ECHO, allowed: ['auto', 'filter_sweep', 'echo_out'] });
    expect(noSwap.style).toBe('filter_sweep');
    const offByName = scriptSeam({ a: track(124), b: track(124), move: 'reverb_wash', abilities: ECHO, allowed: ['auto', 'bass_swap_blend'] });
    expect(offByName.style).toBe('bass_swap_blend');
    expect(offByName.degraded).toContainEqual({ wanted: 'reverb_wash', instead: 'auto', reason: 'that move is off for this account' });
    const nothing = scriptSeam({ a: track(120), b: track(100), move: 'auto', abilities: ECHO, allowed: ['auto'] });
    expect(nothing.kind).toBe('fade');
  });

  it('fades, saying why, when the outgoing song has no sure beat', () => {
    const schedule = scriptSeam({ a: track(120, 0.2), b: track(120), move: 'auto', abilities: ECHO });
    expect(schedule.kind).toBe('fade');
    expect(schedule.degraded?.at(-1)?.reason).toContain('outgoing song');
  });

  it('echoes out: A’s last beat into the send, A cut on the beat, B landing under the tail', () => {
    const schedule = scriptSeam({ a: track(120), b: track(90, 0.2), move: 'echo_out', abilities: ECHO });
    expect(schedule.implementation).toContain(SEAM_EFFECTS_IMPLEMENTATION);
    const cut = schedule.startSeconds;
    expect(of(schedule.events, 'b', 'start')[0]).toMatchObject({ at: cut });
    expect(of(schedule.events, 'a', 'send').map((event) => [event.effect, event.value])).toEqual([['echo', 0], ['echo', 1], ['echo', 1], ['echo', 0]]);
    expect(of(schedule.events, 'a', 'send')[1].at).toBeCloseTo(cut - 0.5, 6);
    expect(of(schedule.events, 'a', 'gain').at(-1)).toMatchObject({ value: 0 });
    expect(schedule.effects?.echo).toMatchObject({ delaySeconds: 0.5, returnHighpassHz: 300 });
  });

  it('washes A’s last two beats into a room as A fades over one beat', () => {
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'reverb_wash', abilities: ECHO });
    const cut = schedule.startSeconds;
    const sends = of(schedule.events, 'a', 'send');
    expect(sends.every((event) => event.effect === 'wash')).toBe(true);
    expect(sends[0].at).toBeCloseTo(cut - 1, 6);
    expect(of(schedule.events, 'a', 'gain').at(-1)).toMatchObject({ value: 0 });
    expect(of(schedule.events, 'a', 'gain').at(-1)?.at).toBeCloseTo(cut + 0.5, 6);
    expect(schedule.effects?.wash).toEqual(washFor());
    // without the returns it is a labelled fade, never a silent swap
    expect(scriptSeam({ a: track(120), b: track(120), move: 'reverb_wash', abilities: ALL }).kind).toBe('fade');
  });

  it('leaves on the last 8-bar phrase line that fits, never before the settle rule', () => {
    const a = track(120);
    expect(phraseExit(a, 8, LEAVE_AFTER_SECONDS)).toBeCloseTo(160, 6);
    expect((phraseExit(a, 8, LEAVE_AFTER_SECONDS) / 0.5) % (PHRASE_BARS * 4)).toBe(0);
    const short = track(120, 0.9, false, 40);
    expect(phraseExit(short, 8, LEAVE_AFTER_SECONDS)).toBe(LEAVE_AFTER_SECONDS);
    expect(phraseExit(track(120, 0.1), 8, LEAVE_AFTER_SECONDS)).toBe(170);
  });
});
