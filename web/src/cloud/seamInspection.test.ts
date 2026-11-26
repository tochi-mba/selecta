import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { setFlags } from '../flags';
import { browserFlags } from './browserFlags';
import type { Booked } from './deviceStudio';
import { askToMake, forgetRatings, inspectedState, inspectorOn, seamOptions, withInspection } from './seamInspection';
import { seamKey } from './seamReports';

// T-20261126-827e: the Seam Inspector shows a transition this device made, from its own clip, the
// planner's answer and the checks the finished audio was measured on.

const studio = vi.hoisted(() => ({ booked: new Map<string, unknown>(), asked: [] as unknown[] }));
vi.mock('./studioWiring', () => ({
  studioOf: () => ({ madeFor: (a: number, b: number) => studio.booked.get(`${a}>${b}`) ?? null }),
  prepareRequestSeams: async (_workspaceId: string, pairs: unknown[], asker: string) => {
    studio.asked.push({ pairs, asker });
    return pairs.length;
  },
}));

const ON = { 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true };
const FINGERPRINT = 'f'.repeat(64);
const RATE = 44_100;

function booked(failures: MadeSeam['facts']['failures'] = []): Booked {
  const made: MadeSeam = {
    status: 'clip',
    rendered: { channels: [new Float32Array(RATE * 2), new Float32Array(RATE * 2)], sampleRate: RATE, aStartSample: RATE * 100, bEndSample: RATE * 12, levels: { a: 1, b: 1 } } as unknown as MadeSeam['rendered'],
    move: 'bass_swap_blend',
    option: 0,
    facts: { passed: failures.length === 0, failures },
    passed: failures.length === 0,
    nearMiss: false,
    fellBack: false,
    beatsAligned: true,
    attempts: [
      { option: 1, move: 'filter_sweep', facts: { passed: false, failures: [{ name: 'low end clash', value: 3, limit: 1, fix: null }] }, ms: 10 },
      { option: 2, move: 'echo_out', facts: null, skipped: 'it needs the timing of sung words', ms: 1 },
      { option: 0, move: 'bass_swap_blend', facts: { passed: true, failures: [] }, ms: 10 },
    ],
    tookMs: 30,
    implementation: 'web-render-1+x',
  };
  return { made, answer: { fingerprint: FINGERPRINT, options: [{ index: 0, option: { move: 'bass_swap_blend', bars: 16, exit_cue: [40, 80, 'phrase', 0.8, 0], entry_cue: [0, 0, 'intro', 0.8, 0] }, reasons: ['phrase into intro', 'vocals take turns'] }] } };
}

const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 200, bpm: null, key: null, locked: false, seam: position ? { settings: { move: 'auto' }, state: { status: 'none', key: `k${position}` } } : null });
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2)], name: 'Mix', can_undo: false };

beforeEach(() => {
  setFlags(ON);
  studio.booked.clear();
  studio.asked = [];
  forgetRatings();
  localStorage.setItem('selecta.device.ws-1', 'dev-1');
});
afterEach(() => {
  setFlags(null);
  localStorage.clear();
});

describe('a transition this device made, as the inspector shows it', () => {
  it('names the move, the planner\'s reasons, where each song is left and joined, the checks and what else was tried', () => {
    const state = inspectedState(booked(), 'abc', 'good');
    expect(state).toMatchObject({
      status: 'ready', key: 'abc', label: 'Blend', style: 'bass_swap_blend', why: 'Phrase into intro, vocals take turns',
      passed: true, bars: 16, a_source_start: 100, b_source_end: 12, duration: 2, rating: 'good',
    });
    expect(state.checks).toEqual([{ name: 'every check', passed: true, text: 'Every check on the finished audio passed', value: '' }]);
    expect(state.tried).toEqual([{ move: 'filter_sweep', why: 'Two bass lines fight' }, { move: 'echo_out', why: 'It needs the timing of sung words' }]);
  });

  it('lists each check the clip did not pass in plain words', () => {
    const state = inspectedState(booked([{ name: 'entry level', value: 4.5, limit: 3, fix: null }]), 'abc');
    expect(state.checks).toEqual([{ name: 'entry level', passed: false, text: 'B comes in too loud', value: '4.5' }]);
    expect(state.rating).toBeUndefined();
  });
});

describe('the mix with this device\'s transitions', () => {
  it('shows a made transition as ready, keyed as it was reported, with its rating and preview', async () => {
    studio.booked.set('1>2', booked());
    const key = await seamKey(1, 2, FINGERPRINT, 0);
    const asked: string[] = [];
    const cloud = (async (path: string) => {
      asked.push(path);
      return { seams: [{ key, rating: 'bad' }] };
    }) as Request;
    URL.createObjectURL = vi.fn(() => 'blob:clip');
    URL.revokeObjectURL = vi.fn();
    const shown = await withInspection(MIX, 'ws-1', cloud);
    expect(shown.mix[1].seam?.state).toMatchObject({ status: 'ready', key, rating: 'bad', preview_url: 'blob:clip' });
    // a transition this device has not made stays as the mix gave it
    expect(shown.mix[2].seam?.state).toEqual({ status: 'none', key: 'k2' });
    expect(asked).toEqual([`/seams?keys=${key}&device_id=dev-1`]);
    // read again from memory, not asked again
    await withInspection(MIX, 'ws-1', cloud);
    expect(asked).toHaveLength(1);
  });

  it('asks nothing and changes nothing with the flags off', async () => {
    setFlags({ ...ON, 'cloud.device_render': false });
    studio.booked.set('1>2', booked());
    const cloud = vi.fn() as unknown as Request;
    expect(inspectorOn()).toBe(false);
    expect(await withInspection(MIX, 'ws-1', cloud)).toBe(MIX);
    expect(cloud).not.toHaveBeenCalled();
  });

  it('asks the studio to make a transition the member opened, as the inspector\'s own ask', async () => {
    expect(await askToMake('ws-1', MIX, 2)).toEqual({ queued: true });
    expect(studio.asked).toEqual([{ pairs: [{ a: 2, b: 3 }], asker: 'inspector' }]);
    expect(await askToMake('ws-1', MIX, 0)).toEqual({ queued: false });
  });

  it('offers the browser\'s own moves to change to, and no Stem Studio', () => {
    const options = seamOptions();
    expect(options.moves[0]).toMatchObject({ name: 'auto', available: true });
    expect(options.studio?.available).toBe(false);
  });

  it('is switched on in the browser shell only where this device makes transitions', () => {
    expect(browserFlags(false).seam_inspector).toBe(false);
    expect(browserFlags(false, false, { studio: true }).seam_inspector).toBeUndefined();
  });
});
