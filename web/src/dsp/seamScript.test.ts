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
import { rampSourceSeconds } from './stretchLimits';

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

const STRETCH: SeamAbilities = { ...ALL, stretch: { ok: true } };

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
    // 32 bars at 120 BPM is 64 s; the window holds 16 bars (32 s), local mode's usual blend
    const schedule = scriptSeam({ a: track(120), b: track(120), move: 'bass_swap_blend', bars: 32, exitBar: 20, abilities: ALL });
    expect(schedule.windowSeconds).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
    expect(schedule.degraded?.[0]).toMatchObject({ wanted: '32 bars', instead: '16 bars' });
    expect(schedule.degraded?.[0].reason).toContain('at most');
  });

  it('with the stretch, B plays at A’s tempo for the whole overlap and eases back; otherwise the beats drift at most an eighth', () => {
    expect(barsThatFit(16, 0.5, 0)).toBe(16);
    expect(barsThatFit(32, 0.5, 0)).toBe(16);
    expect(barsThatFit(8, 0.5, 0.01)).toBe(2); // 0.125 / (4 * 0.01) = 3.1 bars
    const stretched = scriptSeam({ a: track(120), b: track(121.2), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH });
    expect(stretched.windowSeconds).toBeCloseTo(16, 6);
    expect(stretched.degraded).toBeUndefined();
    const stretch = stretched.stretch!;
    expect(stretch.ratio).toBeCloseTo(120 / 121.2, 9);
    expect(stretch.sourceFrom).toBe(of(stretched.events, 'b', 'start')[0].sourceAt);
    expect(stretch.holdUntil).toBeCloseTo(stretched.startSeconds + stretched.windowSeconds, 9);
    // B eases back over 16 of its own beats (timing.py RAMP_BEATS), then native B takes over
    const beatB = 60 / 121.2;
    expect(stretch.inputSeconds).toBeCloseTo(stretch.ratio * 16 + 16 * beatB, 9);
    expect(stretch.handoverSourceAt).toBeCloseTo(stretch.sourceFrom + stretch.inputSeconds, 9);
    expect(stretch.handoverAt).toBe(stretch.rampUntil);
    const ramp = { ratio: stretch.ratio, holdSeconds: stretch.holdUntil - stretched.startSeconds, rampSeconds: stretch.rampUntil - stretch.holdUntil };
    expect(stretch.sourceFrom + rampSourceSeconds(ramp, stretch.handoverAt - stretched.startSeconds)).toBeCloseTo(stretch.handoverSourceAt, 9);
    // a gap within 0.2 percent settles over 8 beats instead
    const settled = scriptSeam({ a: track(120), b: track(120.12), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH }).stretch!;
    expect(settled.inputSeconds - settled.ratio * 16).toBeCloseTo(8 * 60 / 120.12, 9);
    // matching tempos need no stretch at all
    expect(scriptSeam({ a: track(120), b: track(120), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH }).stretch).toBeUndefined();
    // without the stretch a 1 percent gap still shortens the overlap, as before
    const plain = scriptSeam({ a: track(120), b: track(121.2), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: ALL });
    expect(plain.windowSeconds).toBeCloseTo(4, 6);
    expect(plain.stretch).toBeUndefined();
    expect(plain.degraded?.[0].reason).toContain('can\'t stretch them to match');
    // beyond the 8 percent limit the stretch can't help: the old drift bound applies
    const far = scriptSeam({ a: track(120), b: track(131), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH });
    expect(far.kind).toBe('fade');
    expect(far.stretch).toBeUndefined();
    expect(far.degraded?.at(-1)?.reason).toContain('more than the 8 percent this browser can stretch');
  });

  it('stretches B alone to A’s tempo for gaps from 3 to 8 percent, keeping A native', () => {
    const wide = scriptSeam({ a: track(124), b: track(130), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH });
    expect(wide.kind).toBe('beatmatch');
    expect(wide.stretch?.ratio).toBeCloseTo(124 / 130, 9);
    // A has no tempo events at all: nothing on deck a moves its speed
    expect(wide.events.filter((event) => event.deck === 'a').every((event) => ['gain', 'eq', 'filter', 'stop'].includes(event.kind))).toBe(true);
  });

  it('falls back to an unstretched seam when B ends before it could ease back', () => {
    const short = scriptSeam({ a: track(120), b: track(121.2, 0.9, false, 20), move: 'bass_swap_blend', bars: 8, exitBar: 20, abilities: STRETCH });
    expect(short.stretch).toBeUndefined();
    expect(short.windowSeconds).toBeCloseTo(4, 6);
    expect(short.degraded?.[0].reason).toContain('too short to ease back');
  });

  it('plays tempo_ramp with the stretch: a short overlap, then a long ease back over 32 beats', () => {
    const ramp = scriptSeam({ a: track(120), b: track(127), move: 'tempo_ramp', exitBar: 20, abilities: STRETCH });
    expect(ramp.style).toBe('tempo_ramp');
    expect(ramp.bars).toBe(4);
    expect(ramp.windowSeconds).toBeCloseTo(8, 6);
    expect(ramp.stretch!.inputSeconds - ramp.stretch!.ratio * 8).toBeCloseTo(32 * 60 / 127, 9);
    expect(of(ramp.events, 'a', 'eq').length).toBeGreaterThan(0);
    // without the stretch it is a fade, with the reason
    const flat = scriptSeam({ a: track(120), b: track(127), move: 'tempo_ramp', exitBar: 20, abilities: ALL });
    expect(flat.kind).toBe('fade');
    expect(flat.degraded).toContainEqual(expect.objectContaining({ wanted: 'stretch', instead: 'fade' }));
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
    // with the stretch, a 1.6 percent gap is absorbed by stretching the next song, as local mode lets B absorb it
    const stretched = scriptSeam({ a: track(124), b: track(126), move: 'auto', abilities: { ...ECHO, stretch: { ok: true } } });
    expect(stretched.style).toBe('bass_swap_blend');
    // 16 bars at 124 BPM is about 31 s, inside the 32 s window: local mode's usual blend
    expect(stretched.bars).toBe(16);
    expect(stretched.stretch?.ratio).toBeCloseTo(124 / 126, 9);
    expect(stretched.stretch?.holdUntil).toBeCloseTo(stretched.startSeconds + stretched.windowSeconds, 9);
    expect(stretched.why).toBe('The tempos are 1.6 percent apart, so the next song is stretched to match without changing its pitch, and both play in time for 16 bars and trade the bass on a bar line.');
    // 6 percent is still inside the stretch limit
    expect(scriptSeam({ a: track(124), b: track(131.5), move: 'auto', abilities: { ...ECHO, stretch: { ok: true } } }).style).toBe('bass_swap_blend');
    // beyond 8 percent it echoes out, and says the gap is past the limit
    const far = scriptSeam({ a: track(124), b: track(136), move: 'auto', abilities: { ...ECHO, stretch: { ok: true } } });
    expect(far.style).toBe('echo_out');
    expect(far.why).toContain('more than the 8 percent this browser can stretch');
    // without the stretch even 1.6 percent drifts too far for eight bars
    const plain = scriptSeam({ a: track(124), b: track(126), move: 'auto', abilities: ECHO });
    expect(plain.style).toBe('echo_out');
    expect(plain.stretch).toBeUndefined();
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

  it('without a sure beat on the first song, washes it out (or cuts), as local mode still moves', () => {
    const washed = scriptSeam({ a: track(120, 0.2), b: track(120), move: 'auto', abilities: ECHO });
    expect(washed.style).toBe('reverb_wash');
    expect(washed.why).toContain('isn’t clear enough to blend or echo in time');
    expect(scriptSeam({ a: track(120, 0.2), b: track(120), move: 'auto', abilities: ALL }).style).toBe('cut_on_one');
    // an echo needs the beat it repeats on: asked for by name, it fades and says why
    const echo = scriptSeam({ a: track(120, 0.2), b: track(120), move: 'echo_out', abilities: ECHO });
    expect(echo.kind).toBe('fade');
    expect(echo.degraded?.at(-1)?.reason).toContain('outgoing song');
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
