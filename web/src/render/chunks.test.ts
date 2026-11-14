import { describe, expect, it } from 'vitest';
import { artifactIdentity, RenderFailure, type PortableRenderRecipe, type RenderSource } from './contracts';
import { renderChunks } from './chunks';

function fixtures(totalFrames = 9001, clipStart = 0) {
  const recipe: PortableRenderRecipe = {
    recipeId: 'test', revisionId: 'v1', schemaVersion: 1,
    sampleRate: 48000, channels: 2, totalFrames,
    clips: [{ occurrenceId: 'a', recordingId: 'one', sourceRevision: 'hash-a', startFrame: clipStart,
      sourceStartFrame: 0, durationFrames: totalFrames - clipStart, gain: 0.5 }],
  };
  const reads: number[] = [];
  const source: RenderSource = {
    recordingId: 'one', sourceRevision: 'hash-a', durationFrames: totalFrames,
    async read(start, length) {
      reads.push(length);
      return [Float32Array.from({ length }, (_, i) => Math.sin((start + i) / 10))];
    },
  };
  return { recipe, reads, sources: new Map([['one', source]]) };
}
describe('browser frame-accurate chunk renderer', () => {
  it('uses bounded source windows without missing or repeating frames', async () => {
    const { recipe, sources, reads } = fixtures();
    const values: number[] = [];
    for await (const chunk of renderChunks({ recipe, sources, signal: new AbortController().signal, chunkFrames: 1024 })) {
      values.push(...chunk.channels[0]);
      expect(chunk.channels[0]).toEqual(chunk.channels[1]); // mono -> stereo
    }
    expect(values).toHaveLength(9001);
    expect(Math.max(...reads)).toBeLessThanOrEqual(1024);
    [0, 1023, 1024, 2048, 8999, 9000].forEach(i => expect(values[i]).toBeCloseTo(0.5 * Math.sin(i / 10), 5));
  });
  it('adds overlapping clips by absolute sample index across chunk boundaries', async () => {
    const f = fixtures(8193, 0);
    f.recipe = { ...f.recipe, clips: [
      ...f.recipe.clips,
      { occurrenceId: 'second', recordingId: 'one', sourceRevision: 'hash-a', startFrame: 4095,
        sourceStartFrame: 0, durationFrames: 4098, gain: 0.25 },
    ] };
    const all: number[] = [];
    for await (const chunk of renderChunks({ recipe: f.recipe, sources: f.sources, signal: new AbortController().signal, chunkFrames: 4096 })) {
      all.push(...chunk.channels[0]);
    }
    expect(all[4094]).toBeCloseTo(0.5 * Math.sin(4094 / 10));
    expect(all[4095]).toBeCloseTo(0.5 * Math.sin(4095 / 10));
    expect(all[4096]).toBeCloseTo(0.5 * Math.sin(4096 / 10) + 0.25 * Math.sin(1 / 10));
  });
  it('rejects missing revisions instead of silently replacing them', async () => {
    const f = fixtures();
    f.recipe = { ...f.recipe, clips: [{ ...f.recipe.clips[0], sourceRevision: 'wrong' }] };
    await expect((async () => { for await (const _ of renderChunks({ ...f, signal: new AbortController().signal })) {/* drain */} })()).rejects.toBeInstanceOf(RenderFailure);
  });
  it('aborts during incremental processing', async () => {
    const f = fixtures();
    const controller = new AbortController();
    const iterator = renderChunks({ ...f, signal: controller.signal });
    expect((await iterator.next()).done).toBe(false);
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ state: 'cancelled' });
  });
  it('changes artifact identity for revision and processor changes', async () => {
    const f = fixtures();
    const a = await artifactIdentity(f.recipe, [], 'wav');
    const b = await artifactIdentity({ ...f.recipe, revisionId: 'new' }, [], 'wav');
    const c = await artifactIdentity(f.recipe, [], 'flac');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
