import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_CALIBRATION_IMPLEMENTATION } from '../dsp/budget';
import { makeWorkerSeamProvider, type SeamRecord } from '../dsp/seamProvider';
import type { SeamAbilities } from '../dsp/seamScript';
import type { SeamSchedule, TrackTiming } from '../dsp/seams';
import type { Request } from './accountFacts';
import type { AccountSeamAsk } from './accountSeams';
import {
  ALLOWANCE_USED_LINE, askPair, clipFrom, CLOUD_TRANSITION_WHY, CloudSeams, cloudWaitMs, ERRORS_TRIED, gainOf, POLL_FOR_MS,
  withCloudSeams, type CloudPair, type SeamAnswer,
} from './cloudSeams';
import { playedWords } from './playedSeams';
import { settleRendered } from './renderedPlan';

// cloud.studio_seams: the cloud studio's clips played by the shared engine. The route is asked for
// the next two seams and asked again, bounded, while it works; each song next to a cloud seam plays
// its lossless file at the clip's level; the clip is counted in samples at the playing rate; and
// anything that does not fit (late, another level, another file, refused, used up, no copy) plays
// the live plan.

const RATE = 44_100;
const ABLE: SeamAbilities = { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: true }, stems: { ok: false, reason: 'no stems' }, echo: { ok: true } };
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const LEVELS = { a_gain_db: -4.25, b_gain_db: -1.5 };

type Audio = { length: number; duration: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };
const audioOf = (data: Float32Array, rate: number, channels = 2): Audio => ({ length: data.length, duration: data.length / rate, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data });
const wave = (seconds: number, rate: number, phase: number) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, at) => 0.2 * Math.sin(at * 0.013 + phase));

/** Two songs and a clip whose joins are those songs at the clip's levels, as the cloud makes it. */
function songsAndClip(rate = RATE, levels = { a: gainOf(LEVELS.a_gain_db), b: gainOf(LEVELS.b_gain_db) }) {
  const a = wave(30, rate, 0);
  const b = wave(30, rate, 1);
  const length = Math.round(6 * rate);
  const join = Math.trunc(0.03 * rate);
  const aStart = Math.round(20 * rate);
  const bEnd = Math.round(4 * rate);
  const clip = new Float32Array(length);
  for (let at = 0; at < join; at += 1) {
    clip[at] = Math.fround(a[aStart + at] * levels.a);
    clip[length - join + at] = Math.fround(b[bEnd - join + at] * levels.b);
  }
  return { from: audioOf(a, rate), to: audioOf(b, rate), clip: audioOf(clip, rate) };
}

const file = (side: 'a' | 'b', rate = 48_000) => ({ url: `https://r2.test/${side}.flac?sig=1`, sha256: side === 'a' ? A : B, sample_rate: rate, seconds: 30 });
const clipLink = (extra: Partial<NonNullable<SeamAnswer['clip']>> = {}) => ({
  url: 'https://r2.test/clip.flac?sig=1', sha256: C, a_source_start: 20, b_source_end: 4, seconds: 6, sample_rate: 44_100, switch_at: 3, b_warp: null, ...extra,
});
const queued = (): SeamAnswer => ({ state: 'queued', files: { a: file('a'), b: file('b', 44_100) }, levels: LEVELS });
const ready = (extra: Partial<NonNullable<SeamAnswer['clip']>> = {}): SeamAnswer => ({ ...queued(), state: 'ready', move: 'bass_swap_blend', passed: true, fell_back: false, clip: clipLink(extra) });

type Body = { a: number; b: number; move: string | null; lane: string };

/** The account's seams route, answering per ask; the signed links' bytes with their hashes. */
function fakeAccount(answer: (body: Body, count: number) => SeamAnswer | Error) {
  const asked: Body[] = [];
  const request = (async (path: string, init?: RequestInit) => {
    expect(path).toBe('/hosted/seams');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as Body;
    expect(Object.keys(body)).toEqual(['a', 'b', 'move', 'lane']);
    asked.push(body);
    const made = answer(body, asked.filter((one) => one.a === body.a && one.b === body.b && one.move === body.move).length);
    if (made instanceof Error) throw made;
    return made;
  }) as Request;
  const hashes = new WeakMap<ArrayBuffer, string>();
  const fetched: string[] = [];
  const wrong = new Set<string>();
  const fetchBytes = async (url: string) => {
    fetched.push(url);
    const bytes = new ArrayBuffer(8);
    const sha = url.includes('clip') ? C : url.includes('/a.') ? A : B;
    hashes.set(bytes, wrong.has(sha) ? 'f'.repeat(64) : sha);
    return bytes;
  };
  return { asked, request, fetched, fetchBytes, wrong, sha256: async (bytes: ArrayBuffer) => hashes.get(bytes) ?? '' };
}

const failed = (status: number) => Object.assign(new Error(`status ${status}`), { status });
const pair = (a: number, b: number, move: string | null = null): CloudPair => ({ a, b, move });
// a long first song, so the provider may wait for a clip still on its way
const ask = (extra: Partial<AccountSeamAsk> = {}): AccountSeamAsk => ({ fromIndex: 0, toIndex: 1, fromSeconds: 200, toSeconds: 30, settings: {}, abilities: ABLE, ...extra });
const never = () => new Promise<void>(() => undefined);

afterEach(() => vi.useRealTimers());

describe('the clip, counted at the playing rate', () => {
  for (const [rate, aStart, bEnd] of [[44_100, 882_000, 176_400], [48_000, 960_000, 192_001]] as const) {
    it(`at ${rate} Hz, whatever rate the files carry`, () => {
      const audio = audioOf(new Float32Array(6 * rate), rate);
      const made = clipFrom(audio, { ...ready({ a_source_start: 20.00001, b_source_end: 4.0000113 }), files: { a: file('a', 48_000), b: file('b', 44_100) } } as never)!;
      expect(made.sampleRate).toBe(rate);
      expect([made.aStartSample, made.bEndSample]).toEqual([aStart, bEnd]);
      expect(made.levels).toEqual({ a: 10 ** (-4.25 / 20), b: 10 ** (-1.5 / 20) });
      expect(made.switchAt).toBe(3);
      // no warp from an older seam: B straight across the clip, ending where the clip hands over
      expect(made.bWarp).toEqual({ output: [0, 6], source: [4.0000113 - 6, 4.0000113] });
    });
  }

  it('takes the record’s switch and warp when it has them, its middle otherwise, and refuses a clip of another length', () => {
    const audio = audioOf(new Float32Array(6 * RATE), RATE, 1);
    const warp = { output: [0, 6], source: [-1, 4] };
    expect(clipFrom(audio, ready({ switch_at: 2.5, b_warp: warp }) as never)).toMatchObject({ switchAt: 2.5, bWarp: warp, channels: [expect.any(Float32Array)] });
    expect(clipFrom(audio, ready({ switch_at: null }) as never)?.switchAt).toBe(3);
    expect(clipFrom(audioOf(new Float32Array(7 * RATE), RATE), ready() as never)).toBeNull();
  });

  it('waits for a clip at most the render wait, and never past the earliest it could start', () => {
    expect(cloudWaitMs({ fromIndex: 0, fromSeconds: 240 }, { index: 0, seconds: 1 })).toBe(90_000);
    expect(cloudWaitMs({ fromIndex: 0, fromSeconds: 120 }, { index: 0, seconds: 1 })).toBe(32_000);
    expect(cloudWaitMs({ fromIndex: 0, fromSeconds: 80 }, null)).toBe(0);
  });
});

describe('asking the route for one pair', () => {
  it('asks again while it works, then fetches the clip and checks its hash', async () => {
    const account = fakeAccount((_, count) => (count === 1 ? queued() : count === 2 ? { ...queued(), state: 'running' } : ready()));
    const delays: number[] = [];
    const asked = await askPair(pair(1, 2, 'bass_swap_blend'), 'interactive', { ...account, sleep: async (ms) => { delays.push(ms); } }, new AbortController().signal);
    expect('ready' in asked && asked.ready.clip.url).toBe('https://r2.test/clip.flac?sig=1');
    expect(delays).toEqual([2000, 4000]);
    expect(account.asked).toEqual(Array(3).fill({ a: 1, b: 2, move: 'bass_swap_blend', lane: 'interactive' }));
    account.wrong.add(C);
    expect(await askPair(pair(1, 2), 'standard', { ...account, sleep: async () => undefined }, new AbortController().signal)).toEqual({ declined: expect.stringMatching(/did not arrive whole/) });
  });

  it('gives up within its bound when the cloud keeps working, or cannot be reached', async () => {
    let clock = 0;
    const slow = fakeAccount(() => queued());
    const delays: number[] = [];
    const asked = await askPair(pair(1, 2), 'interactive', { ...slow, now: () => clock, sleep: async (ms) => { delays.push(ms); clock += ms; } }, new AbortController().signal);
    expect(asked).toEqual({ declined: expect.stringMatching(/took too long/) });
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(POLL_FOR_MS);
    expect(Math.max(...delays)).toBe(30_000);
    expect(slow.asked.length).toBeLessThan(40);
    const down = fakeAccount(() => failed(503));
    expect(await askPair(pair(1, 2), 'interactive', { ...down, sleep: async () => undefined }, new AbortController().signal)).toEqual({ declined: expect.stringMatching(/could not be reached/) });
    expect(down.asked).toHaveLength(ERRORS_TRIED);
  });

  it('stops at once on no cloud copy, a refusal, a used-up allowance or a failure', async () => {
    const cases: [SeamAnswer | Error, RegExp | string][] = [
      [failed(404), /not in your cloud library/],
      [failed(403), /does not make this transition/],
      [{ state: 'refused', code: 'allowance_used', why: 'Used up' }, ALLOWANCE_USED_LINE],
      [{ state: 'refused', code: 'not_admitted', why: 'busy' }, /could not take it on: busy/],
      [{ state: 'failed', why: 'no beat' }, /could not make it: no beat/],
    ];
    for (const [answer, words] of cases) {
      const account = fakeAccount(() => answer);
      const asked = await askPair(pair(1, 2), 'interactive', { ...account, sleep: async () => undefined }, new AbortController().signal);
      expect(asked).toEqual({ declined: typeof words === 'string' ? words : expect.stringMatching(words) });
      expect(account.asked).toHaveLength(1);
      expect(account.fetched).toEqual([]);
    }
  });
});

/** A CloudSeams over a fake account, with the playing songs decoded and noted. */
function studio(answer: Parameters<typeof fakeAccount>[0], options: { sleep?: (ms: number) => Promise<void>; heard?: { index: number; seconds: number } | null } = {}) {
  const account = fakeAccount(answer);
  const made = songsAndClip();
  const cloud = new CloudSeams({ ...account, sleep: options.sleep ?? (async () => undefined), on: () => true, decode: async () => made.clip, heard: () => options.heard ?? null });
  return { account, cloud, ...made };
}

describe('the next two cloud seams', () => {
  it('asks only for the next two, and drops a seam once it is behind or the mix changed', async () => {
    const wakes: (() => void)[] = [];
    const { account, cloud } = studio(() => queued(), { sleep: () => new Promise<void>((done) => wakes.push(done)) });
    const seams = [pair(1, 2), pair(2, 3), pair(3, 4), pair(4, 5)];
    cloud.follow(seams, 1);
    await vi.waitFor(() => expect(account.asked).toHaveLength(2));
    expect(account.asked.map((body) => [body.a, body.b, body.lane])).toEqual([[2, 3, 'interactive'], [3, 4, 'interactive']]);
    cloud.follow(seams, 2);
    await vi.waitFor(() => expect(account.asked).toHaveLength(3));
    expect(account.asked[2]).toMatchObject({ a: 4, b: 5 });
    // asked again after the wait: (2, 3) was dropped and asks no more
    await vi.waitFor(() => expect(wakes).toHaveLength(3));
    for (const wake of wakes.splice(0)) wake();
    await vi.waitFor(() => expect(account.asked).toHaveLength(5));
    expect(account.asked.slice(3).map((body) => body.a).sort()).toEqual([3, 4]);
    // the mix edited: the same songs with another move are another seam
    cloud.follow([null, null, pair(3, 4, 'echo_out'), pair(4, 5)], 2);
    await vi.waitFor(() => expect(account.asked).toHaveLength(6));
    expect(account.asked[5]).toMatchObject({ a: 3, b: 4, move: 'echo_out' });
    cloud.dispose();
  });

  it('plays a song next to a cloud seam from its lossless file at its clip’s level', async () => {
    const { account, cloud } = studio((_, count) => (count === 1 ? queued() : ready()), { sleep: never });
    const usual = vi.fn(async () => null);
    cloud.follow([pair(1, 2)], 0);
    const first = await cloud.songAt(0, 1, usual);
    const second = await cloud.songAt(1, 2, usual);
    expect(first).toMatchObject({ id: `cloud:${A}`, source: 'hosted', level: gainOf(-4.25) });
    expect(second).toMatchObject({ id: `cloud:${B}`, source: 'hosted', level: gainOf(-1.5) });
    await second!.data();
    expect(account.fetched).toEqual(['https://r2.test/b.flac?sig=1']);
    expect(usual).not.toHaveBeenCalled();
    // a song that is not the seam's, or no seam at all: as before
    expect(await cloud.songAt(1, 9, usual)).toBeNull();
    expect(await cloud.songAt(5, 7, usual)).toBeNull();
  });

  it('gives the clip at the songs’ levels, and a level that differs is refused for the live plan', async () => {
    const { cloud, from, to } = studio((_, count) => (count === 1 ? queued() : ready()));
    cloud.follow([pair(1, 2)], 0);
    const [a, b] = [await cloud.songAt(0, 1, async () => null), await cloud.songAt(1, 2, async () => null)];
    cloud.noteDecoded(a!.id, from);
    cloud.noteDecoded(b!.id, to);
    const answer = await cloud.planned(ask({ from: from as never, to: to as never, fromLevel: a!.level, toLevel: b!.level }));
    expect(answer && 'schedule' in answer && answer.schedule).toMatchObject({ chosenBy: { by: 'cloud' }, why: CLOUD_TRANSITION_WHY, style: 'bass_swap_blend', implementation: 'cloud-studio-1' });
    const rendered = answer && 'schedule' in answer ? answer.schedule.rendered! : null;
    expect(rendered?.levels).toEqual({ a: a!.level, b: b!.level });
    expect(rendered?.aStartSample).toBe(20 * RATE);
    // the provider's own check: these very songs at these levels pass, another level does not
    expect(settleRendered(answer, { from, to, fromLevel: a!.level, toLevel: b!.level })).toBe(answer);
    expect(settleRendered(answer, { from, to, fromLevel: a!.level, toLevel: 0.5 })).toEqual({ declined: expect.stringMatching(/another level/) });
  });

  it('plays a song whose lossless file fails its hash from its usual file, with no clip next to it', async () => {
    const { account, cloud, from, to } = studio((_, count) => (count === 1 ? queued() : ready()));
    account.wrong.add(B);
    cloud.follow([pair(1, 2)], 0);
    const usualBytes = new ArrayBuffer(4);
    const b = await cloud.songAt(1, 2, async () => ({ id: 2, data: async () => usualBytes }));
    expect(await b!.data()).toBe(usualBytes);
    cloud.noteDecoded(`cloud:${A}`, from);
    cloud.noteDecoded(b!.id, to);
    expect(await cloud.planned(ask({ from: from as never, to: to as never }))).toEqual({ declined: expect.stringMatching(/not playing from its file/) });
  });

  it('drops a clip that is not ready in time, or that would start too soon', async () => {
    const late = studio(() => queued(), { sleep: never });
    late.cloud.follow([pair(1, 2)], 0);
    // 87.05 s long: 50 ms to wait before the earliest a clip could start, less the guards
    expect(await late.cloud.planned(ask({ fromSeconds: 87.05 }))).toEqual({ declined: expect.stringMatching(/not ready in time/) });
    const soon = studio(() => ready(), { heard: { index: 0, seconds: 15 } });
    soon.cloud.follow([pair(1, 2)], 0);
    soon.cloud.noteDecoded(`cloud:${A}`, soon.from);
    soon.cloud.noteDecoded(`cloud:${B}`, soon.to);
    expect(await soon.cloud.planned(ask({ from: soon.from as never, to: soon.to as never }))).toEqual({ declined: expect.stringMatching(/ready too late/) });
  });

  it('says once in the seam info when the day’s transitions are used up, and the live plan plays', async () => {
    const { cloud } = studio(() => ({ state: 'refused', code: 'allowance_used', why: 'Used up for today' }));
    cloud.follow([pair(1, 2)], 0);
    const planner = withCloudSeams(cloud, async () => ({ declined: 'a song is not playing from this device’s own files' }));
    expect(await planner(ask())).toEqual({ declined: ALLOWANCE_USED_LINE });
    const live = { implementation: 'x', kind: 'beatmatch', startSeconds: 20, windowSeconds: 8, events: [], style: 'blend', chosenBy: { by: 'device', note: ALLOWANCE_USED_LINE } } as SeamSchedule;
    expect(playedWords(live).detail).toBe(ALLOWANCE_USED_LINE);
    expect(playedWords({ ...live, kind: 'fade' }).detail).toBe(ALLOWANCE_USED_LINE);
    expect(playedWords({ ...live, chosenBy: { by: 'device', note: 'something else' } }).detail).toBeNull();
  });

  it('falls back to the account’s planner when a song has no cloud copy, and leaves other seams to it', async () => {
    const { cloud } = studio(() => failed(404));
    cloud.follow([pair(1, 2), null], 0);
    const plan = { scripted: {} as never, schedule: { implementation: 'x', kind: 'beatmatch', startSeconds: 1, windowSeconds: 1, events: [], chosenBy: { by: 'account' } } as SeamSchedule };
    const planner = withCloudSeams(cloud, async () => plan);
    expect(await planner(ask())).toMatchObject({ schedule: { chosenBy: { by: 'account', note: expect.stringMatching(/not in your cloud library/) } } });
    expect(await planner(ask({ fromIndex: 1, toIndex: 2 }))).toBe(plan);
  });
});

describe('the seam provider with a clip from the cloud', () => {
  const NOW = 1_700_000_000_000;
  const DEVICE = 'cloud-seams-test-device';
  const calibration = { implementation: WORKER_CALIBRATION_IMPLEMENTATION as typeof WORKER_CALIBRATION_IMPLEMENTATION, deviceId: DEVICE, calibratedAt: NOW, samples: 3, msPerBlock: 10, horizonS: 30 };
  const timing = (): TrackTiming => ({ beats: Array.from({ length: 60 }, (_, beat) => beat * 0.5), tempo: { bpm: 120, confidence: 0.9, ambiguous: false }, durationSeconds: 30 });

  it('plays the clip and keeps this device’s own choice as what plays instead, with no audio kept', async () => {
    const { cloud, from, to } = studio(() => ready());
    cloud.follow([pair(1, 2)], 0);
    // the clip is in hand before the seam is planned (its songs are only 30 s long here)
    await cloud.planned(ask());
    cloud.noteDecoded(`cloud:${A}`, from);
    cloud.noteDecoded(`cloud:${B}`, to);
    const records: SeamRecord[] = [];
    const own = vi.fn(timing);
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'auto' }), abilities: () => ABLE, calibration, deviceId: DEVICE, now: () => NOW,
      workerFactory: () => { throw new Error('no worker in this test'); }, timing: own, onPlanned: (record) => records.push(record),
      planned: withCloudSeams(cloud, async () => null),
    });
    const levels = { fromLevel: gainOf(LEVELS.a_gain_db), toLevel: gainOf(LEVELS.b_gain_db) };
    const schedule = await provider({ fromIndex: 0, from: from as never, toIndex: 1, to: to as never, ...levels });
    expect(schedule).toMatchObject({ chosenBy: { by: 'cloud' }, rendered: { implementation: 'cloud-studio-1' } });
    expect(schedule.instead).toMatchObject({ kind: expect.any(String) });
    expect(schedule.instead?.rendered).toBeUndefined();
    expect(own).toHaveBeenCalledTimes(2);
    expect(records[0].schedule.rendered?.channels).toEqual([]);
    expect(records[0].schedule.chosenBy).toEqual({ by: 'cloud' });
    // at another level than the clip's, this device chooses, and the record says why
    const other = await provider({ fromIndex: 0, from: from as never, toIndex: 1, to: to as never, ...levels, toLevel: 0.5 });
    expect(other.rendered).toBeUndefined();
    expect(other.chosenBy).toEqual({ by: 'device', note: expect.stringMatching(/another level/) });
  });
});
