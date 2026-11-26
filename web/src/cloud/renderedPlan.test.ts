import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { song } from '../dsp/render/testScripts';
import type { SeamAbilities } from '../dsp/seamScript';
import { setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { accountSeamPlanner, type AccountSeamAsk } from './accountSeams';
import type { DeviceStudio } from './deviceStudio';
import { renderWaitMs, settleRendered } from './renderedPlan';
import { measuredSong, shaOf } from './testAccountFacts';

// The planner's choice made ahead, as the seam the scheduler plays: only with cloud.device_render
// named on, with the live plan kept as what plays instead, and checked against the very songs
// about to play before it is recorded. With the flag off or not named: exactly as before.

const ABLE: SeamAbilities = { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: true }, stems: { ok: false, reason: 'no stems' }, echo: { ok: true } };
const SONG = measuredSong();
const SECONDS = SONG.duration_s;
const barAt = (bar: number) => 0.25 + 2 * bar;
const cue = (bar: number): [number, number, string, number, number] => [bar, barAt(bar), 'phrase', 0.8, 0];
const BLEND = { move: 'bass_swap_blend', bars: 16, exit_cue: cue(48), entry_cue: cue(8) };
const RATE = 44_100;
const A = song(11, SECONDS);
const B = song(12, SECONDS);

/** A clean clip of A into B at level 1: native A for its first join, native B for its last. */
function made(levels = { a: 1, b: 1 }): MadeSeam {
  const length = 12 * RATE;
  return {
    status: 'clip',
    rendered: {
      channels: [new Float32Array(length).fill(0.1), new Float32Array(length).fill(0.1)], sampleRate: RATE,
      aStartSample: 64 * RATE, bEndSample: 30 * RATE, levels, switchAt: 6,
      bWarp: { output: [0, 12], source: [18, 30] }, implementation: 'web-render-1+wsola-stretch-v1',
    },
    move: 'bass_swap_blend', option: 0, facts: { passed: true, failures: [] }, passed: true, nearMiss: false, fellBack: false, beatsAligned: true,
    attempts: [{ option: 0, move: 'bass_swap_blend', facts: { passed: true, failures: [] }, ms: 4000 }], tookMs: 4200, implementation: 'web-render-1+wsola-stretch-v1',
  };
}

function account() {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith('/song-facts?')) return { songs: [11, 12].map((song_id) => ({ song_id, implementation: 'web-dsp-1', source: 'device' })) } as T;
    if (path === '/planning/candidates') return { options: [{ index: 0, option: BLEND }] } as T;
    throw new Error(`unexpected ${path}`);
  };
  return { calls, request };
}

function studioDouble(answer: MadeSeam | null) {
  return {
    candidates: vi.fn(async () => ({ fingerprint: 'f'.repeat(64), options: [{ index: 0, option: BLEND, script: {}, has_script: true }] })),
    clipFor: vi.fn(async () => answer),
  };
}

const ask = (): AccountSeamAsk => ({
  fromIndex: 0, toIndex: 1, fromSeconds: SECONDS, toSeconds: SECONDS, settings: {}, abilities: ABLE,
  from: A.audio as unknown as AudioBuffer, to: B.audio as unknown as AudioBuffer, fromLevel: 1, toLevel: 1,
});

function planner(studio: ReturnType<typeof studioDouble>, request = account().request) {
  return accountSeamPlanner({
    request, workspaceId: 'ws-made', fileOf: (index) => [11, 12][index] ?? null, shaOf: async (songId) => shaOf(songId),
    facts: async () => SONG, heard: () => ({ index: 0, seconds: 1 }), studio: studio as unknown as DeviceStudio,
  });
}

beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true });
});
afterEach(() => setFlags(null));

describe('the planner\'s choice made ahead', () => {
  it('is played as the account-rendered seam, its live plan kept as what plays instead', async () => {
    const studio = studioDouble(made());
    const answer = await planner(studio)(ask());
    expect(answer && 'schedule' in answer).toBe(true);
    if (!answer || !('schedule' in answer)) return;
    expect(answer.schedule).toMatchObject({ chosenBy: { by: 'account-rendered' }, style: 'bass_swap_blend', startSeconds: 64, windowSeconds: 12, kind: 'beatmatch' });
    expect(answer.schedule.rendered?.aStartSample).toBe(64 * RATE);
    expect(answer.schedule.instead).toMatchObject({ style: 'bass_swap_blend', chosenBy: { by: 'account' } });
    expect(answer.schedule.studio).toMatchObject({ move: 'bass_swap_blend', passed: true, attempts: [{ option: 0, passed: true, failed: [] }] });
    expect(studio.clipFor).toHaveBeenCalledWith(expect.objectContaining({ levels: { a: 1, b: 1 } }), expect.any(Number));
  });

  it('plays the live plan, saying why, when no clip is ready in time', async () => {
    const answer = await planner(studioDouble(null))(ask());
    expect(answer && 'schedule' in answer && answer.schedule.chosenBy).toEqual({ by: 'account', note: 'not rendered in time' });
  });

  it('is never asked for with the flag off or not named by the server', async () => {
    const unnamed: Record<string, boolean> = { 'cloud.brain': true, 'cloud.device_analysis': true };
    for (const flags of [unnamed, { ...unnamed, 'cloud.device_render': false }]) {
      setFlags(flags);
      forgetAccountMeasured();
      const studio = studioDouble(made());
      const live = account();
      const answer = await planner(studio, live.request)(ask());
      expect(studio.clipFor).not.toHaveBeenCalled();
      expect(studio.candidates).not.toHaveBeenCalled();
      expect(live.calls.find((call) => call.path === '/planning/candidates')?.body).toMatchObject({ scripts: 0 });
      expect(answer && 'schedule' in answer && answer.schedule.chosenBy).toEqual({ by: 'account' });
    }
  });
});

describe('checking a made clip against the songs about to play', () => {
  const plan = async (clip: MadeSeam) => planner(studioDouble(clip))(ask());

  it('keeps a clip that fits', async () => {
    const answer = await plan(made());
    expect(settleRendered(answer, { from: A.audio as never, to: B.audio as never, fromLevel: 1, toLevel: 1 })).toBe(answer);
  });

  it('gives way to the live plan when the songs play at other levels, or to the device without one', async () => {
    const answer = await plan(made());
    const settled = settleRendered(answer, { from: A.audio as never, to: B.audio as never, fromLevel: 1, toLevel: 0.5 });
    expect(settled && 'schedule' in settled && settled.schedule).toMatchObject({ chosenBy: { by: 'account', note: expect.stringMatching(/another level/) } });
    expect(settled && 'schedule' in settled && settled.schedule.rendered).toBeUndefined();
    if (!answer || !('schedule' in answer)) throw new Error('no plan');
    const alone = { ...answer, schedule: { ...answer.schedule, instead: undefined } };
    expect(settleRendered(alone, { from: A.audio as never, to: B.audio as never, fromLevel: 1, toLevel: 0.5 })).toEqual({ declined: expect.stringMatching(/^not rendered: /) });
  });
});

describe('how long the seam waits for a clip', () => {
  it('waits while the playing song has time before the planner\'s first exit, and not after', () => {
    const answer = { options: [{ option: BLEND }] };
    // the blend's overlap starts 16 bars before its exit cue, at bar 32
    expect(renderWaitMs(answer, SONG, { index: 0, seconds: 1 }, ask())).toBe(Math.min(90_000, (barAt(32) - 1 - 12) * 1000));
    expect(renderWaitMs(answer, SONG, { index: 0, seconds: barAt(32) - 10 }, ask())).toBe(0);
  });
});
