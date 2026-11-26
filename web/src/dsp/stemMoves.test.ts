import { describe, expect, it } from 'vitest';
import {
  chooseStemMove,
  handoffShift,
  historyWeights,
  isRefusal,
  percentile,
  rideLengths,
  seededRandom,
  singingSpans,
  stemArrange,
  stemEvents,
  stemIntertwine,
  stemWeight,
  valueAt,
  vocalRide,
  voiceEdge,
  voiceStop,
  warpAt,
  windowRange,
  HANDOVER_SECONDS,
  NOMINAL_LENGTH,
  OVER_SHARE,
  RECENT_PENALTY,
  SAME_FAMILY_PENALTY,
  type StemLayer,
  type StemPair,
  type StemRecipe,
  type StemSeamPlan,
  type StemWindow,
} from './stemMoves';
import { MAX_WINDOW_SECONDS, type TrackTiming } from './seams';

const RATE = 8000;

function track(bpm: number, duration = 200, confidence = 0.9, ambiguous = false): TrackTiming {
  const period = 60 / bpm;
  const beats = Array.from({ length: Math.floor(duration / period) }, (_, beat) => beat * period);
  return { beats, tempo: { bpm, confidence, ambiguous }, durationSeconds: duration };
}

/** A vocal stem with a 220 Hz tone (about -13.5 dB RMS) over each song-time span. */
function voice(origin: number, seconds: number, spans: Array<[number, number]>, amplitude = 0.3): StemWindow {
  const vocals = new Float32Array(Math.round(seconds * RATE));
  for (const [from, to] of spans) {
    for (let index = Math.round((from - origin) * RATE); index < Math.round((to - origin) * RATE); index += 1) {
      if (index >= 0 && index < vocals.length) vocals[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / RATE);
    }
  }
  return { origin, sampleRate: RATE, vocals };
}

/** A's lines: 3.5 s sung, 0.5 s breath, from 150 s to 178 s. */
const A_LINES: Array<[number, number]> = Array.from({ length: 7 }, (_, line) => [150 + line * 4, 153.5 + line * 4]);
const B_LINES: Array<[number, number]> = [[30, 33.5], [34, 37.5]];

function pair(overrides: Partial<StemPair> = {}): StemPair {
  return {
    a: track(120),
    b: track(120),
    aWindow: voice(140, 60, A_LINES),
    bWindow: voice(0, 45, B_LINES),
    ...overrides,
  };
}

function plan(recipe: StemRecipe): StemSeamPlan {
  if (isRefusal(recipe)) throw new Error(`refused: ${recipe.refused}`);
  return recipe;
}

const layer = (p: StemSeamPlan, side: 'a' | 'b', stem: string): StemLayer => {
  const found = p.layers.find((l) => l.side === side && l.stem === stem);
  if (!found) throw new Error(`no ${side} ${stem}`);
  return found;
};

function expectInsideWindows(p: StemSeamPlan, source: StemPair) {
  for (const l of p.layers) {
    const [from, to] = windowRange(l.side === 'a' ? source.aWindow : source.bWindow);
    const last = l.side === 'a' ? l.until : warpAt(p.bWarp, l.until);
    expect(l.sourceFrom).toBeGreaterThanOrEqual(from);
    expect(last).toBeLessThanOrEqual(to);
  }
}

describe('voice sensing', () => {
  it('finds sung spans in song time', () => {
    const spans = singingSpans(voice(10, 20, [[11, 13], [15, 17]]));
    expect(spans).toHaveLength(2);
    expect(spans[0][0]).toBeCloseTo(11, 1);
    expect(spans[0][1]).toBeCloseTo(13, 1);
    expect(spans[1][0]).toBeCloseTo(15, 1);
  });

  it('joins a breath of 0.35 s or less and drops bursts under 0.3 s', () => {
    expect(singingSpans(voice(0, 10, [[1, 2], [2.25, 3]]))).toHaveLength(1);
    expect(singingSpans(voice(0, 10, [[1, 1.2]]))).toHaveLength(0);
    expect(singingSpans(voice(0, 10, [[1, 2], [3, 4]]))).toHaveLength(2);
  });

  it('treats a voice quieter than -35 dB as nobody singing', () => {
    expect(singingSpans(voice(0, 10, [[1, 5]], 0.01))).toHaveLength(0);
  });

  it('finds where a line stops and starts from the stem alone', () => {
    const window = voice(10, 20, [[11, 13], [15, 17]]);
    expect(voiceEdge(window, [11, 13], 15, true)).toBeCloseTo(13, 1);
    expect(voiceEdge(window, [15, 17], 30, false)).toBeCloseTo(15, 1);
    expect(Math.abs((voiceEdge(window, [11, 13], 15, true) ?? 0) - 13)).toBeLessThan(0.03);
  });

  it('returns no edge where there is no clear voice', () => {
    expect(voiceEdge(voice(0, 10, []), [2, 4], 6, true)).toBeNull();
  });

  it('takes the quietest moment when a line has no clean rest', () => {
    const window = voice(0, 10, [[1, 6]]);
    const edge = voiceEdge(window, [1, 3], 3, true);
    expect(edge).not.toBeNull();
    expect(Math.abs((edge as number) - 3)).toBeLessThanOrEqual(0.41);
  });

  it('matches numpy percentile', () => {
    expect(percentile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 9);
  });
});

describe('intertwined stems', () => {
  const source = pair();
  const p = plan(stemIntertwine(source));
  const span = p.endSeconds - HANDOVER_SECONDS - p.startSeconds;
  const at = (nominal: number) => p.startSeconds + (nominal * span) / NOMINAL_LENGTH;

  it('runs 16 bars from a phrase line inside A window, after the settle rule', () => {
    expect(p.move).toBe('stem_intertwine');
    expect(p.bars).toBe(16);
    expect(span).toBeCloseTo(32, 6);
    expect(Math.round(p.startSeconds / 0.5) % 32).toBe(0);
    expect(p.startSeconds).toBeGreaterThanOrEqual(140);
    expect(p.layers).toHaveLength(8);
    expect(p.windowSeconds).toBeGreaterThan(MAX_WINDOW_SECONDS);
    expectInsideWindows(p, source);
  });

  it('draws local mode curves, scaled to the real bars', () => {
    const gain = (side: 'a' | 'b', stem: string, nominal: number) => valueAt(layer(p, side, stem).gain, at(nominal));
    expect(gain('a', 'drums', 12)).toBeCloseTo(1, 6);
    expect(gain('a', 'drums', 14)).toBeCloseTo(0.5, 6);
    expect(gain('a', 'drums', 16)).toBeCloseTo(0, 6);
    expect(gain('b', 'drums', 4)).toBeCloseTo(0, 6);
    expect(gain('b', 'drums', 8)).toBeCloseTo(0.5, 6);
    expect(gain('b', 'drums', 12)).toBeCloseTo(1, 6);
    expect(gain('a', 'bass', 13)).toBeCloseTo(0.5, 6);
    expect(gain('b', 'bass', 13)).toBeCloseTo(0.5, 6);
    expect(gain('a', 'other', 14)).toBeCloseTo(0.5, 6);
    expect(gain('b', 'other', 14)).toBeCloseTo(0.5, 6);
    expect(gain('a', 'vocals', 15)).toBeCloseTo(0.5, 6);
    expect(gain('b', 'vocals', 16)).toBeCloseTo(0, 6);
    expect(gain('b', 'vocals', 17)).toBeCloseTo(0.5, 6);
    expect(gain('b', 'vocals', 25)).toBeCloseTo(1, 6);
  });

  it('takes over from A full mix and hands over to B full mix', () => {
    const aDrums = layer(p, 'a', 'drums').gain;
    expect(valueAt(aDrums, p.startSeconds - HANDOVER_SECONDS)).toBe(0);
    expect(valueAt(aDrums, p.startSeconds + HANDOVER_SECONDS)).toBe(1);
    expect(valueAt(p.native.a, p.startSeconds + HANDOVER_SECONDS)).toBe(0);
    expect(valueAt(layer(p, 'b', 'drums').gain, p.endSeconds)).toBe(0);
    expect(valueAt(p.native.b, p.endSeconds)).toBe(1);
    expect(p.handoverToNative.bSourceAt).toBeCloseTo(p.bStartSourceAt + span - HANDOVER_SECONDS, 6);
  });

  it('says the key was not checked and holds the stricter tempo rule', () => {
    expect(p.keyChecked).toBe(false);
    expect(p.why).toContain('Key wasn');
    const twoPercent = pair({ b: track(120 / 1.02) });
    const refused = stemIntertwine(twoPercent);
    expect(isRefusal(refused) && refused.refused).toContain('key isn\'t known');
    const keyed = plan(stemIntertwine({ ...twoPercent, keyDistance: 1 }));
    expect(keyed.keyChecked).toBe(true);
    expect(keyed.bSourcePerSecond).toBeCloseTo(1.02, 6);
    expectInsideWindows(keyed, twoPercent);
    expect(warpAt(keyed.bWarp, keyed.bWarp[1][0]) - keyed.bWarp[0][1]).toBeCloseTo(4 * (60 / (120 / 1.02)), 6);
  });

  it('refuses in plain words', () => {
    const reason = (r: StemRecipe) => (isRefusal(r) ? r.refused : 'played');
    expect(reason(stemIntertwine({ ...pair(), keyDistance: 3 }))).toContain('key');
    expect(reason(stemIntertwine(pair({ b: track(120, 200, 0.5) })))).toContain('steady');
    expect(reason(stemIntertwine(pair({ a: track(120, 200, 0.9, true) })))).toContain('half or double');
    expect(reason(stemIntertwine({ ...pair(), beatsPerBar: { a: 4, b: 3 } }))).toContain('beats to the bar');
    expect(reason(stemIntertwine({ ...pair(), keyDistance: 0, b: track(125) }))).toContain('apart in tempo');
    expect(reason(stemIntertwine(pair({ aWindow: voice(180, 20, []) })))).toContain('room for 16 bars');
    const short = track(120, 55);
    expect(reason(stemIntertwine(pair({ a: short, aWindow: voice(0, 55, []) })))).toContain('room for 16 bars');
    expect(reason(stemIntertwine(pair({ bWindow: voice(0, 20, []) })))).toContain('room for 16 bars');
  });

  it('flattens to sorted SeamEvent-style events per stem', () => {
    const events = stemEvents(p);
    expect(events.filter((e) => e.kind === 'start')).toHaveLength(9);
    expect(events.every((e, i) => i === 0 || events[i - 1].at <= e.at)).toBe(true);
    expect(events.some((e) => e.stem === 'mix' && e.deck === 'b' && e.kind === 'start')).toBe(true);
  });
});

describe('vocal ride', () => {
  const source = pair();
  const p = plan(vocalRide(source));
  const vocals = layer(p, 'a', 'vocals');
  const voiceEnd = vocals.gain[3][0] - 0.015;
  const handoff = p.endSeconds - 0.015;

  it('rides A last sung line over B band, as long as A sings', () => {
    expect(p.move).toBe('vocal_ride');
    expect(p.bars).toBe(12);
    expect(voiceEnd).toBeCloseTo(177.5 + 0.02, 1);
    expect(p.startSeconds).toBeGreaterThanOrEqual(140);
    expect(p.layers.map((l) => `${l.side}.${l.stem}`).sort()).toEqual(['a.bass', 'a.drums', 'a.other', 'a.vocals', 'b.bass', 'b.drums', 'b.other']);
    expectInsideWindows(p, source);
  });

  it('crosses the bands under A voice and hands over as B sings', () => {
    const mid = p.startSeconds + (voiceEnd - p.startSeconds) * 0.9;
    expect(valueAt(vocals.gain, mid)).toBe(1);
    expect(valueAt(vocals.gain, voiceEnd + 0.02)).toBe(0);
    expect(valueAt(layer(p, 'a', 'drums').gain, p.startSeconds + 0.1)).toBe(1);
    expect(valueAt(layer(p, 'a', 'drums').gain, mid)).toBe(0);
    expect(valueAt(layer(p, 'b', 'drums').gain, mid)).toBeCloseTo(1, 6);
    expect(valueAt(layer(p, 'b', 'drums').gain, handoff + 0.015)).toBe(0);
    expect(valueAt(p.native.b, handoff + 0.015)).toBe(1);
    expect(p.handoverToNative.bSourceAt).toBeCloseTo(30 - 0.02 - 0.015, 1);
    const sweep = layer(p, 'b', 'other').filter?.[0];
    expect(sweep?.filter).toBe('lowpass');
    expect(sweep?.points[0][1]).toBe(300);
    expect(sweep?.points[1][1]).toBe(20000);
    const aLow = layer(p, 'a', 'bass').eq?.[0].points ?? [];
    const bLow = layer(p, 'b', 'bass').eq?.[0].points ?? [];
    expect((aLow[0][0] + aLow[1][0]) / 2).toBeCloseTo(p.startSeconds + 4 * 4 * 0.5, 6);
    expect(aLow.map(([, v]) => v)).toEqual([1, 0]);
    expect(bLow.map(([, v]) => v)).toEqual([0, 1]);
  });

  it('echoes A last word in time', () => {
    const send = vocals.sends?.[0].points ?? [];
    expect(valueAt(send, voiceEnd - 0.1)).toBe(1);
    expect(valueAt(send, voiceEnd - 0.5)).toBe(0);
    expect(p.echo?.delaySeconds).toBeCloseTo(0.5, 6);
    expect(p.echo?.feedback).toBeGreaterThanOrEqual(0.15);
    expect(p.echo?.feedback).toBeLessThanOrEqual(0.4);
  });

  it('refuses without a voice on either side', () => {
    const noA = vocalRide(pair({ aWindow: voice(140, 60, []) }));
    expect(isRefusal(noA) && noA.refused).toContain('Nobody is singing near the end');
    const noB = vocalRide(pair({ bWindow: voice(0, 45, []) }));
    expect(isRefusal(noB) && noB.refused).toContain('Nobody is singing near the start');
    const early = vocalRide(pair({ bWindow: voice(0, 45, [[2, 5]]) }));
    expect(isRefusal(early)).toBe(true);
  });

  it('works out ride lengths and the downbeat-aligned handoff shift', () => {
    expect(rideLengths([[100, 200]], 180, 2)).toEqual([12, 8, 4]);
    expect(rideLengths([], 180, 2)).toEqual([8, 4]);
    expect(handoffShift(10.3, 40, 4)).toBe(28);
    expect(handoffShift(10, 41, 4) % 4).toBe(0);
  });
});

describe('strip and land (reduced)', () => {
  // an evenly loud voice leaves the voice stop where the shape puts it
  const source = pair({ aWindow: voice(140, 60, [[140, 200]]) });
  const p = plan(stemArrange(source));
  const step = (p.endSeconds - HANDOVER_SECONDS - p.startSeconds) / 8;
  const cell = (side: 'a' | 'b', stem: string, index: number) => {
    const l = p.layers.find((x) => x.side === side && x.stem === stem);
    return l ? valueAt(l.gain, p.startSeconds + (index + 0.5) * step) : 0;
  };

  it('plays local mode starting shape and labels itself reduced', () => {
    expect(p.move).toBe('stem_arrange');
    expect(p.bars).toBe(16);
    expect(p.why).toContain('reduced strip and land');
    expect([0, 1].map((i) => cell('a', 'bass', i))).toEqual([1, 0]);
    expect([1, 2].map((i) => cell('a', 'drums', i))).toEqual([1, 0]);
    expect([3, 4].map((i) => cell('a', 'vocals', i))).toEqual([1, 0]);
    expect([0, 7].map((i) => cell('a', 'other', i))).toEqual([1, 1]);
    expect([2, 3, 4, 5, 6].map((i) => cell('b', 'other', i))).toEqual([0, 1, 1, 0, 1]);
    expect([5, 6, 7].map((i) => cell('b', 'bass', i))).toEqual([0, 1, 1]);
    expect([6, 7].map((i) => cell('b', 'drums', i))).toEqual([0, 1]);
    expect(p.layers.some((l) => l.side === 'b' && l.stem === 'vocals')).toBe(false);
    expectInsideWindows(p, source);
  });

  it('moves A voice stop to the quietest nearby square boundary', () => {
    const start = p.startSeconds;
    const gap = start + 5 * step;
    const loud = voice(140, 60, [[140, gap - 0.4], [gap + 0.4, 200]]);
    const moved = plan(stemArrange(pair({ aWindow: loud })));
    const vocals = moved.layers.find((l) => l.side === 'a' && l.stem === 'vocals');
    expect(valueAt(vocals?.gain ?? [], start + 4.5 * step)).toBe(1);
    expect(valueAt(vocals?.gain ?? [], start + 5.5 * step)).toBe(0);
    expect(moved.why).toContain('square 6');
    expect(voiceStop(() => 1)).toBe(4);
  });

  it('refuses outside its tempo and grid gates', () => {
    const fast = stemArrange(pair({ b: track(120 / 1.03) }));
    expect(isRefusal(fast) && fast.refused).toContain('apart in tempo');
    const grid = stemArrange(pair({ a: track(120, 200, 0.7) }));
    expect(isRefusal(grid) && grid.refused).toContain('steady');
    expect(isRefusal(stemArrange({ ...pair({ b: track(120 / 1.03) }), keyDistance: 2 }))).toBe(false);
  });
});

describe('choosing a stem move', () => {
  const base = { ...pair(), totalSeams: 10, seed: 1 };

  it('plays nothing when stems are set to never', () => {
    const choice = chooseStemMove({ ...base, stems: 'never' });
    expect(choice.plan).toBeNull();
    expect(choice.refusals).toHaveLength(3);
  });

  it('weights moves as local mode does', () => {
    expect(stemWeight('vocal_ride', 'sometimes')).toBe(3);
    expect(stemWeight('vocal_ride', 'often')).toBe(4.5);
    expect(stemWeight('stem_intertwine', 'sometimes')).toBe(0.35);
    expect(stemWeight('stem_intertwine', 'often')).toBe(1.3);
    expect(stemWeight('stem_arrange', 'sometimes')).toBe(1.5);
    expect(stemWeight('stem_arrange', 'often')).toBe(2.25);
    expect(stemWeight('vocal_ride', 'sometimes', 'punchy')).toBe(1.5);
    const choice = chooseStemMove({ ...base, stems: 'often' });
    expect(choice.weights).toEqual([
      { move: 'vocal_ride', weight: 4.5 },
      { move: 'stem_intertwine', weight: 1.3 },
      { move: 'stem_arrange', weight: 2.25 },
    ]);
  });

  it('caps shares, skips repeats and penalises recent moves and families', () => {
    const options = [{ move: 'vocal_ride', weight: 3 }, { move: 'stem_intertwine', weight: 0.35 }, { move: 'stem_arrange', weight: 1.5 }];
    const capped = historyWeights(options, [], 10, { vocal_ride: 3 });
    expect(capped[0].weight).toBeCloseTo(3 * OVER_SHARE, 9);
    expect(historyWeights(options, [], 10, { vocal_ride: 2 })[0].weight).toBe(3);
    expect(historyWeights(options, ['vocal_ride'], 10).map((o) => o.move)).toEqual(['stem_intertwine', 'stem_arrange']);
    const recent = historyWeights(options, ['stem_arrange', 'echo_out'], 20);
    expect(recent.find((o) => o.move === 'stem_arrange')?.weight).toBeCloseTo(1.5 * RECENT_PENALTY, 9);
    const family = historyWeights(options, ['bass_swap_blend', 'filter_sweep'], 20);
    expect(family.find((o) => o.move === 'stem_intertwine')?.weight).toBeCloseTo(0.35 * SAME_FAMILY_PENALTY, 9);
    expect(historyWeights([{ move: 'vocal_ride', weight: 3 }], ['vocal_ride'], 10)).toHaveLength(1);
  });

  it('is deterministic per seed and follows the weights across seeds', () => {
    const one = chooseStemMove({ ...base, stems: 'sometimes', seed: 42 });
    const again = chooseStemMove({ ...base, stems: 'sometimes', seed: 42 });
    expect(again.picked).toBe(one.picked);
    expect(one.plan?.move).toBe(one.picked);
    const random = seededRandom(7);
    const draws = Array.from({ length: 4000 }, random);
    expect(draws.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(draws.reduce((sum, x) => sum + x, 0) / draws.length).toBeCloseTo(0.5, 1);
  });

  it('draws in proportion to the weights', () => {
    const sensed = { a: singingSpans(base.aWindow), b: singingSpans(base.bWindow) };
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 300; seed += 1) {
      const picked = chooseStemMove({ ...base, sensed, stems: 'sometimes', seed }).picked ?? 'none';
      counts[picked] = (counts[picked] ?? 0) + 1;
    }
    expect((counts.vocal_ride ?? 0) / 300).toBeGreaterThan(0.5);
    expect((counts.vocal_ride ?? 0) / 300).toBeLessThan(0.75);
    expect(counts.stem_arrange ?? 0).toBeGreaterThan(counts.stem_intertwine ?? 0);
  });

  it('honours allowed moves, rating factors and competing moves', () => {
    const only = chooseStemMove({ ...base, stems: 'sometimes', allowed: ['stem_arrange'] });
    expect(only.picked).toBe('stem_arrange');
    expect(only.refusals.map((r) => r.move).sort()).toEqual(['stem_intertwine', 'vocal_ride']);
    const rated = chooseStemMove({ ...base, stems: 'sometimes', factors: { vocal_ride: 0, stem_arrange: 0 } });
    expect(rated.picked).toBe('stem_intertwine');
    const other = chooseStemMove({ ...base, stems: 'sometimes', others: [{ move: 'bass_swap_blend', weight: 1e9 }] });
    expect(other.picked).toBe('bass_swap_blend');
    expect(other.plan).toBeNull();
  });

  it('returns null with every reason when nothing fits', () => {
    const choice = chooseStemMove({ ...base, b: track(150), stems: 'often' });
    expect(choice.plan).toBeNull();
    expect(choice.picked).toBeNull();
    expect(choice.refusals).toHaveLength(3);
    expect(choice.refusals.every((r) => r.reason.includes('apart in tempo'))).toBe(true);
  });
});
