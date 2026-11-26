import { describe, expect, it } from 'vitest';
import { renderSong, type SynthSong } from '../analysis/synth';
import type { BeatRuntime } from '../analysis/beatThis/runtime';
import { analyseRequest } from './analysisWorker';

// The analysis worker with the neural beat tracker (docs/engineering/device-beats.md): a `song`
// asked with `beatModel` runs Beat This, reports its time for the benchmark, and falls back to
// the interim source for that song, saying why, when the model will not load or run.

const files = import.meta.glob('../golden/device-analysis/break-174-f-minor.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const song = (JSON.parse(Object.values(files)[0]) as { song: SynthSong }).song;
const SHA = 'a'.repeat(64);

function request(beatModel?: { sha256: string }) {
  return { id: 1, sampleRate: song.sampleRate, pcm: new Float32Array(0), tasks: ['song' as const], channels: renderSong(song), ...(beatModel ? { beatModel } : {}) };
}

/** A runtime that predicts nothing anywhere: no beats, so the song has no steady beat. */
const silentRuntime: BeatRuntime = {
  backend: 'wasm',
  run: async (_spect, frames) => ({ beat: new Float32Array(frames).fill(-5), downbeat: new Float32Array(frames).fill(-5) }),
  release: async () => undefined,
};

describe('the worker with Beat This', () => {
  it('measures with the tracker and reports how long it took', async () => {
    const answer = await analyseRequest(request({ sha256: SHA }), async () => silentRuntime);
    expect(answer.facts?.beat_source).toBe('web-beatthis-small0-1');
    expect(answer.facts?.error).toBe('no steady beat found');
    expect(answer.beatMs).toBeGreaterThanOrEqual(0);
    expect(answer.beatFallback).toBeUndefined();
  });

  it('falls back to the interim source for this song when the model will not load, and says why', async () => {
    const answer = await analyseRequest(request({ sha256: 'b'.repeat(64) }), async () => { throw new Error('the beat model in storage does not match its fingerprint'); });
    expect(answer.facts?.beat_source).toBe('web-onset-comb-beats-1');
    expect(answer.beatFallback).toBe('the beat model in storage does not match its fingerprint');
    expect(answer.beatMs).toBeUndefined();
  });

  it('runs the interim source as before when no model is named, or the name is not a fingerprint', async () => {
    let loads = 0;
    const load = async () => { loads += 1; return silentRuntime; };
    expect((await analyseRequest(request(), load)).facts?.beat_source).toBe('web-onset-comb-beats-1');
    expect((await analyseRequest(request({ sha256: '../../etc' }), load)).facts?.beat_source).toBe('web-onset-comb-beats-1');
    expect(loads).toBe(0);
  });
});
