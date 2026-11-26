import { describe, expect, it, vi } from 'vitest';
import type { RenderSeamResponse, RenderSeamSource } from '../workers/renderWorker';
import { makeSeam, type MakerInput, type RankedOption } from './seamMaker';
import { failed, option, PASSED, RATE, ready, scriptText, song } from './testScripts';

// The seam maker follows the Desktop's loop (choose_transition, tighten_beats, _best_move) over
// scripted audit outcomes. The render worker is a double that answers in order.

type Call = { script: Record<string, any>; sources: RenderSeamSource[]; timeoutMs: number };

function rig(answers: ((script: string) => RenderSeamResponse)[], input: Partial<MakerInput> & { options: RankedOption[] }) {
  const calls: Call[] = [];
  const render = vi.fn(async (script: string, sources: RenderSeamSource[], options: { timeoutMs: number }) => {
    calls.push({ script: JSON.parse(script), sources, timeoutMs: options.timeoutMs });
    const answer = answers.shift();
    if (!answer) throw new Error('rendered more often than the test expected');
    return answer(script);
  });
  const made: MakerInput = {
    fallback: { option: option('cut_on_one', 0, 30), script: scriptText({ aStart: 50 }) },
    a: song(1), b: song(2), render, fetchScript: vi.fn(async () => null), deadline: Date.now() + 60_000,
    ...input,
  };
  return { calls, render, input: made };
}

const ranked = (index: number, move: string, bars: number, exitBar: number, script?: string | null): RankedOption => ({ index, option: option(move, bars, exitBar), script });

describe('the seam maker', () => {
  it('plays the first option when its take passes, rendered once', async () => {
    const text = scriptText({ aStart: 10, bStart: 0, duration: 4 });
    const { calls, input } = rig([(script) => ready(script, PASSED)], { options: [ranked(0, 'bass_swap_blend', 16, 40, text)] });
    const made = await makeSeam(input);
    expect(made).toMatchObject({ status: 'clip', option: 0, move: 'bass_swap_blend', passed: true, fellBack: false, nearMiss: false });
    expect(calls).toHaveLength(1);
    if (made.status !== 'clip') return;
    // in_context's joins: A's sample at a_source_start, B's after b_source_end
    expect(made.rendered.aStartSample).toBe(10 * RATE);
    expect(made.rendered.bEndSample).toBe(4 * RATE);
    expect(made.rendered.switchAt).toBe(2);
    expect(made.attempts).toEqual([expect.objectContaining({ option: 0, facts: PASSED })]);
  });

  it('moves on as the repair rule says when a take fails: a shorter blend after "shorten"', async () => {
    const options = [
      ranked(0, 'bass_swap_blend', 16, 40, scriptText({ aStart: 10 })),
      ranked(1, 'filter_sweep', 16, 40, scriptText({ aStart: 20 })),
      ranked(2, 'bass_swap_blend', 8, 40, scriptText({ aStart: 30 })),
    ];
    const { calls, input } = rig([
      (script) => ready(script, failed('vocal overlap', 6, 2, 'shorten')),
      (script) => ready(script, PASSED),
    ], { options });
    const made = await makeSeam(input);
    expect(made).toMatchObject({ status: 'clip', option: 2 });
    expect(calls.map((call) => call.script.a.warp.source[0])).toEqual([10, 30]);
  });

  it('fetches a script the first answer did not carry, by the option\'s own index', async () => {
    const fetchScript = vi.fn(async (index: number) => scriptText({ aStart: index }));
    const { calls, input } = rig([(script) => ready(script, PASSED)], { options: [ranked(11, 'bass_swap_blend', 16, 40)], fetchScript });
    const made = await makeSeam(input);
    expect(fetchScript).toHaveBeenCalledWith(11);
    expect(made).toMatchObject({ status: 'clip', option: 0 });
    expect(calls[0].script.a.warp.source[0]).toBe(11);
  });

  it('steps over what this device cannot render, never rendering it and never counting it', async () => {
    const options = [
      ranked(0, 'bass_swap_blend', 16, 40, scriptText({ stem: true })),
      ranked(1, 'delay_throw', 0, 40, scriptText()),
      ranked(2, 'filter_sweep', 8, 41, scriptText({ bRate: 1.05, duration: 70 })),
      ranked(3, 'echo_out', 0, 42, null),
      ranked(4, 'reverb_wash', 0, 43, scriptText({ aStart: 12 })),
    ];
    const { calls, input } = rig([(script) => ready(script, PASSED)], { options, a: song(1, 120), b: song(2, 120) });
    const made = await makeSeam(input);
    expect(calls).toHaveLength(1);
    expect(made).toMatchObject({ status: 'clip', option: 4 });
    if (made.status !== 'clip') return;
    expect(made.attempts.slice(0, 4).map((attempt) => attempt.skipped)).toEqual([
      'it needs a stem this device does not have',
      'it needs the timing of sung words',
      'it changes the speed of more than a minute of a song',
      'the planner built no transition there',
    ]);
    expect(made.attempts.slice(0, 4).every((attempt) => attempt.facts === null)).toBe(true);
  });

  it('renders each take at the level each song plays at here, from windows of those songs only', async () => {
    const { calls, input } = rig([(script) => ready(script, PASSED, { value: 0.05 })], {
      options: [ranked(0, 'bass_swap_blend', 16, 40, scriptText({ aStart: 10 }))],
      a: song(1, 60, 0.1, 0.5), b: song(2, 60, 0.1, 0.5),
    });
    const made = await makeSeam(input);
    expect(made.status).toBe('clip');
    expect(calls[0].script.a.facts.gain_db).toBeCloseTo(20 * Math.log10(0.5), 12);
    expect(calls[0].script.b.facts.gain_db).toBeCloseTo(20 * Math.log10(0.5), 12);
    expect(calls[0].sources.map((source) => [source.offset, source.channels[0].length])).toEqual([[10 * RATE, 4 * RATE], [0, 4 * RATE]]);
  });

  it('tightens the beats once when they missed by a steady gap, keeping the closer take', async () => {
    const text = scriptText({ aStart: 10, bStart: 5, beats: true, style: 'bass_swap_blend' });
    const { calls, input } = rig([
      (script) => ready(script, failed('beat alignment', 40, 20, 'change_recipe'), { beatOffset: 0.012 }),
      (script) => ready(script, PASSED),
    ], { options: [ranked(0, 'bass_swap_blend', 16, 40, text)] });
    const made = await makeSeam(input);
    expect(calls).toHaveLength(2);
    // tighten_beats: B's warp read `offset` earlier, so B plays that much later
    expect(calls[1].script.b.warp.source[0]).toBeCloseTo(5 - 0.012, 12);
    expect(made).toMatchObject({ status: 'clip', passed: true });
    if (made.status === 'clip') expect(made.attempts[0].tightened).toBe(true);
  });

  it('ends on the fallback cut, itself rendered and checked, when every option fails', async () => {
    const options = [ranked(0, 'bass_swap_blend', 16, 40, scriptText({ aStart: 10 })), ranked(1, 'filter_sweep', 8, 41, scriptText({ aStart: 20 }))];
    const { calls, input } = rig([
      (script) => ready(script, failed('low end clash', 0.9, 0.15, 'change_recipe')),
      (script) => ready(script, failed('low end clash', 0.9, 0.15, 'change_recipe')),
      (script) => ready(script, PASSED),
    ], { options });
    const made = await makeSeam(input);
    expect(calls.map((call) => call.script.a.warp.source[0])).toEqual([10, 20, 50]);
    expect(made).toMatchObject({ status: 'clip', option: 'fallback', fellBack: true, passed: true });
  });

  it('plays a near miss only when not even the cut comes out clean', async () => {
    const near = failed('level fall', 4.5, 3.5, 'move_cue');
    const options = [ranked(0, 'bass_swap_blend', 16, 40, scriptText({ aStart: 10 }))];
    const cutFails = rig([(script) => ready(script, near), (script) => ready(script, failed('quiet time', 4, 1.2, 'close_gap'))], { options });
    expect(await makeSeam(cutFails.input)).toMatchObject({ status: 'clip', option: 0, nearMiss: true, fellBack: false });
    const cutClean = rig([(script) => ready(script, near), (script) => ready(script, PASSED)], { options });
    expect(await makeSeam(cutClean.input)).toMatchObject({ status: 'clip', option: 'fallback', passed: true });
  });

  it('has no clip once the deadline has passed, and renders nothing', async () => {
    const { render, input } = rig([], { options: [ranked(0, 'bass_swap_blend', 16, 40, scriptText())], deadline: Date.now() - 1 });
    const made = await makeSeam(input);
    expect(made).toMatchObject({ status: 'none', reason: 'it ran out of time' });
    expect(render).not.toHaveBeenCalled();
  });

  it('gives each render only the time left before the deadline', async () => {
    let clock = 1_000;
    const { calls, input } = rig([(script) => ready(script, PASSED)], { options: [ranked(0, 'bass_swap_blend', 16, 40, scriptText())], now: () => clock, deadline: 31_000 });
    await makeSeam(input);
    expect(calls[0].timeoutMs).toBe(30_000);
    clock += 1;
  });

  it('refuses a clip of the wrong length, and one much louder than the songs around it', async () => {
    const options = [ranked(0, 'bass_swap_blend', 16, 40, scriptText())];
    const short = rig([(script) => ready(script, PASSED, { length: 100 })], { options });
    expect(await makeSeam(short.input)).toMatchObject({ status: 'none', reason: 'the transition came back the wrong length' });
    const loud = rig([(script) => ready(script, PASSED, { value: 0.5 })], { options });
    expect(await makeSeam(loud.input)).toMatchObject({ status: 'none', reason: 'it came out louder than the songs around it' });
  });

  it('makes nothing where the songs play at a rate the renderer does not work at', async () => {
    const { render, input } = rig([], { options: [ranked(0, 'bass_swap_blend', 16, 40, scriptText())], a: song(1, 60, 0.1, 1, 48_000), b: song(2, 60, 0.1, 1, 48_000) });
    expect(await makeSeam(input)).toMatchObject({ status: 'none' });
    expect(render).not.toHaveBeenCalled();
  });
});
