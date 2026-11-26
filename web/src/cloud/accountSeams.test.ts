import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_CALIBRATION_IMPLEMENTATION } from '../dsp/budget';
import { makeWorkerSeamProvider, type PcmLike, type SeamRecord } from '../dsp/seamProvider';
import type { SeamAbilities } from '../dsp/seamScript';
import type { TrackTiming } from '../dsp/seams';
import { PLANNED_TRANSITION_WHY } from '../copy';
import { setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { accountSeamPlanner, LATE_GUARD_SECONDS, type AccountSeamAsk } from './accountSeams';
import { CloudError } from './api';
import { liveMoveFor, PLANNER_MOVES } from './plannerMoves';
import { measuredSong, shaOf } from './testAccountFacts';

// docs/engineering/device-to-account.md, "Each transition": the planner's best move the live
// engine plays exactly as planned, on the planner's cue times and the measured grids; anything
// else (no live equivalent, not measured, a failed, slow or late answer, the member's own
// choice) leaves the choice to this device, as before.

const ABLE: SeamAbilities = { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: true }, stems: { ok: false, reason: 'no stems' }, echo: { ok: true } };
// both songs: 120 BPM, 64 bars from 0.25 s, so bar n starts at 0.25 + 2n seconds
const SONG = measuredSong();
const SECONDS = SONG.duration_s;
const barAt = (bar: number) => 0.25 + 2 * bar;
const cue = (bar: number): [number, number, string, number, number] => [bar, barAt(bar), 'phrase', 0.8, 0];
const option = (move: string, bars: number, exitBar: number, entryBar: number) => ({ move, bars, exit_cue: cue(exitBar), entry_cue: cue(entryBar) });

type Call = { method: string; path: string; body?: Record<string, unknown> };

function fakeAccount(options: { measured?: number[]; candidates?: () => unknown } = {}) {
  const calls: Call[] = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET' && path.startsWith('/song-facts?')) return { songs: (options.measured ?? [11, 12]).map((song_id) => ({ song_id, implementation: 'web-dsp-1', source: 'device' })) } as T;
    if (method === 'POST' && path === '/planning/candidates') {
      const answer = options.candidates?.();
      if (answer instanceof Error) throw answer;
      return answer as T;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { request, calls };
}

function plannerFor(account: ReturnType<typeof fakeAccount>, extra: { heard?: () => { index: number; seconds: number } | null; within?: number } = {}) {
  return accountSeamPlanner({
    request: account.request, workspaceId: 'ws-seams',
    fileOf: (index) => [11, 12][index] ?? null,
    shaOf: async (songId) => shaOf(songId),
    facts: async () => SONG,
    ...extra,
  });
}

const ask = (over: Partial<AccountSeamAsk> = {}): AccountSeamAsk => ({ fromIndex: 0, toIndex: 1, fromSeconds: SECONDS, toSeconds: SECONDS, settings: {}, abilities: ABLE, ...over });

beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
});
afterEach(() => setFlags(null));

describe('the planner move table', () => {
  it('maps each planner move onto the live move that plays it, and nothing for the rest', () => {
    expect(liveMoveFor('bass_swap_blend')).toEqual({ live: 'bass_swap_blend', beatmatched: true });
    expect(liveMoveFor('filter_sweep')).toEqual({ live: 'filter_sweep', beatmatched: true });
    expect(liveMoveFor('cut_on_one')).toEqual({ live: 'cut_on_one', beatmatched: false });
    expect(liveMoveFor('echo_out')).toEqual({ live: 'echo_out', beatmatched: false });
    expect(liveMoveFor('reverb_wash')).toEqual({ live: 'reverb_wash', beatmatched: false });
    expect(liveMoveFor('tempo_ramp')).toBeNull();
    expect(liveMoveFor('delay_throw')).toBeNull();
    expect(liveMoveFor('word_cut')).toBeNull();
    expect(liveMoveFor('toString')).toBeNull();
    // every recipe in planner_core/recipes/__init__.py all_recipes has a row
    expect(Object.keys(PLANNER_MOVES).sort()).toEqual(['bass_swap_blend', 'cut_on_one', 'delay_throw', 'echo_out', 'filter_sweep', 'reverb_wash', 'tempo_ramp']);
  });
});

describe('a transition from the account', () => {
  it('passes over moves with no live equivalent and plays the next on the planner\'s cue times', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [
      { index: 0, option: option('delay_throw', 0, 48, 8) },
      { index: 1, option: option('tempo_ramp', 4, 48, 8) },
      { index: 2, option: option('bass_swap_blend', 16, 48, 8) },
    ] }) });
    const answer = await plannerFor(account)(ask());
    expect(answer && 'schedule' in answer).toBe(true);
    const { schedule, scripted } = answer as Extract<typeof answer, { schedule: unknown }>;
    expect(schedule).toMatchObject({ kind: 'beatmatch', style: 'bass_swap_blend', bars: 16, why: PLANNED_TRANSITION_WHY, chosenBy: { by: 'account' } });
    // the planner's exit cue ends the 16-bar overlap, so it starts 16 bars earlier, on A's measured bar line
    expect(schedule.startSeconds).toBe(barAt(32));
    expect(scripted).toMatchObject({ exitSeconds: barAt(32), entrySeconds: barAt(8), move: 'bass_swap_blend', bars: 16 });
    expect(schedule.events.find((event) => event.kind === 'start')).toMatchObject({ deck: 'b', at: barAt(32), sourceAt: barAt(8) });
    // the grid is the measured one, not "second 0" and "the end of the song"
    expect(scripted.a.beats[0]).toBe(0.25);
    expect(account.calls.find((call) => call.path === '/planning/candidates')?.body).toEqual({ a: 11, b: 12, leave_after: 30, scripts: 0 });
  });

  it('plays a cut at the planner\'s exit and enters B at its entry cue', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [{ index: 0, option: option('cut_on_one', 0, 50, 4) }] }) });
    const answer = await plannerFor(account)(ask());
    const { schedule } = answer as Extract<typeof answer, { schedule: unknown }>;
    expect(schedule.style).toBe('cut_on_one');
    expect(Math.abs(schedule.startSeconds - barAt(50))).toBeLessThan(0.01);
    expect(schedule.events.find((event) => event.kind === 'start')?.sourceAt).toBeCloseTo(barAt(4) - 0.008, 6);
  });

  it('passes over a move this device can only play changed, for the next that plays as planned', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [
      { index: 0, option: option('bass_swap_blend', 16, 48, 8) },
      { index: 1, option: option('echo_out', 0, 48, 8) },
    ] }) });
    const answer = await plannerFor(account)(ask({ abilities: { ...ABLE, eqFilters: { ok: false, reason: 'no EQ here' } } }));
    expect((answer as { schedule: { style: string } }).schedule.style).toBe('echo_out');
  });

  it('falls back to the planner\'s own cut when no ranked option plays here', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [{ index: 0, option: option('delay_throw', 0, 48, 8) }], fallback: { index: -1, option: option('cut_on_one', 0, 40, 0) } }) });
    const answer = await plannerFor(account)(ask());
    expect((answer as { schedule: { style: string } }).schedule.style).toBe('cut_on_one');
  });

  it('leaves the choice to this device when nothing plays as planned', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [{ index: 0, option: option('tempo_ramp', 4, 48, 8) }] }) });
    expect(await plannerFor(account)(ask())).toEqual({ declined: 'no planned move plays here as planned' });
  });

  it('leaves the choice to this device when a song isn\'t measured in the account, without asking to plan', async () => {
    const account = fakeAccount({ measured: [11] });
    expect(await plannerFor(account)(ask())).toMatchObject({ declined: expect.stringMatching(/not measured in the account/) });
    expect(account.calls.some((call) => call.path === '/planning/candidates')).toBe(false);
  });

  it('leaves the choice to this device when a song plays from somewhere else', async () => {
    const account = fakeAccount();
    const planner = accountSeamPlanner({ request: account.request, workspaceId: 'ws-seams', fileOf: (index) => (index === 0 ? 11 : null), shaOf: async (id) => shaOf(id), facts: async () => SONG });
    expect(await planner(ask())).toMatchObject({ declined: expect.any(String) });
    expect(account.calls).toEqual([]);
  });

  it('leaves the choice to this device when the call fails', async () => {
    const account = fakeAccount({ candidates: () => new CloudError('busy', 503, 'server') });
    expect(await plannerFor(account)(ask())).toMatchObject({ declined: expect.stringMatching(/could not be asked/) });
  });

  it('leaves the choice to this device when the answer is slower than the bound', async () => {
    const slow = fakeAccount({ candidates: () => new Promise(() => undefined) });
    const began = Date.now();
    expect(await plannerFor(slow, { within: 60 })(ask())).toMatchObject({ declined: expect.any(String) });
    expect(Date.now() - began).toBeLessThan(2_000);
  });

  it('leaves the choice to this device when the planned exit is already too close', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [{ index: 0, option: option('cut_on_one', 0, 50, 4) }] }) });
    const heard = () => ({ index: 0, seconds: barAt(50) - LATE_GUARD_SECONDS / 2 });
    expect(await plannerFor(account, { heard })(ask())).toEqual({ declined: 'the planned exit was too close to prepare' });
  });

  it('asks nothing when the member chose the transition, or a flag is off or not named', async () => {
    const account = fakeAccount();
    expect(await plannerFor(account)(ask({ settings: { move: 'echo_out' } }))).toBeNull();
    expect(await plannerFor(account)(ask({ settings: { exit_bar: 40 } }))).toBeNull();
    for (const flags of [{ 'cloud.brain': false, 'cloud.device_analysis': true }, { 'cloud.device_analysis': true }, {}] as Record<string, boolean>[]) {
      setFlags(flags);
      expect(await plannerFor(account)(ask())).toBeNull();
    }
    expect(account.calls).toEqual([]);
  });
});

describe('the seam provider with the account\'s planner', () => {
  const TEST_NOW = 1_700_000_000_000;
  const DEVICE = 'account-seams-test-device';
  const calibration = { implementation: WORKER_CALIBRATION_IMPLEMENTATION as typeof WORKER_CALIBRATION_IMPLEMENTATION, deviceId: DEVICE, calibratedAt: TEST_NOW, samples: 3, msPerBlock: 10, horizonS: 30 };
  const pcm: PcmLike = { sampleRate: 22050, duration: SECONDS, numberOfChannels: 1, getChannelData: () => new Float32Array(10) };
  const deviceTiming = (): TrackTiming => ({ beats: Array.from({ length: 250 }, (_, beat) => beat * 0.5), tempo: { bpm: 120, confidence: 0.9, ambiguous: false }, durationSeconds: SECONDS });

  function providerWith(planned: Parameters<typeof makeWorkerSeamProvider>[0]['planned']) {
    const records: SeamRecord[] = [];
    const timing = vi.fn(deviceTiming);
    const provider = makeWorkerSeamProvider({
      settingsFor: () => ({ move: 'auto' }), abilities: () => ABLE, calibration, deviceId: DEVICE, now: () => TEST_NOW,
      workerFactory: () => { throw new Error('no worker in this test'); }, timing, planned, onPlanned: (record) => records.push(record),
    });
    return { provider, records, timing };
  }

  it('plays the account\'s plan without analysing, and the record says the account chose it', async () => {
    const account = fakeAccount({ candidates: () => ({ options: [{ index: 0, option: option('bass_swap_blend', 16, 48, 8) }] }) });
    const { provider, records, timing } = providerWith(plannerFor(account));
    const schedule = await provider({ fromIndex: 0, from: pcm, toIndex: 1, to: pcm });
    expect(schedule).toMatchObject({ style: 'bass_swap_blend', startSeconds: barAt(32), chosenBy: { by: 'account' } });
    expect(timing).not.toHaveBeenCalled();
    expect(records[0].schedule.chosenBy).toEqual({ by: 'account' });
  });

  it('chooses as before when the account declines, and the record says why', async () => {
    const { provider, records, timing } = providerWith(async () => ({ declined: 'a song is not measured in the account yet' }));
    const schedule = await provider({ fromIndex: 0, from: pcm, toIndex: 1, to: pcm });
    expect(timing).toHaveBeenCalledTimes(2);
    expect(schedule.chosenBy).toEqual({ by: 'device', note: 'a song is not measured in the account yet' });
    expect(records[0].schedule.chosenBy?.by).toBe('device');
  });

  it('records nothing new when the account was not asked', async () => {
    const { provider } = providerWith(async () => null);
    expect((await provider({ fromIndex: 0, from: pcm, toIndex: 1, to: pcm })).chosenBy).toBeUndefined();
    const { provider: without } = providerWith(undefined);
    expect((await without({ fromIndex: 0, from: pcm, toIndex: 1, to: pcm })).chosenBy).toBeUndefined();
  });
});
