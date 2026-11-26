import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportJob, MixData, MixItem, Request } from '../api';
import type { RenderedClip } from '../dsp/seams';
import type { exportFile } from '../engine/export';
import { setFlags } from '../flags';
import { browserFlags } from './browserFlags';
import type { DeviceStudio, StudioSong } from './deviceStudio';
import { exportFamily, fileName, forgetExports, NOT_HERE, type ExportDeps } from './localExport';

// T-20261126-96d3: a mix saved as a file in the browser is written with the transitions playback
// plays: the clip made ahead (or made now) at each boundary, the crossfade where there is none.

const ON = { 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true, 'cloud.local_export': true };
const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: position ? { settings: {}, state: { status: 'none', key: `k${position}` } } : null });
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2)], name: 'Friday', can_undo: false };
const sha = (n: number) => n.toString(16).padStart(64, '0');
const CLIP = { implementation: 'web-render-1', channels: [new Float32Array(4)] } as unknown as RenderedClip;
const fakeBuffer = (n: number) => ({ n }) as unknown as AudioBuffer;

function rig(overrides: Partial<ExportDeps> = {}) {
  const written: Parameters<typeof exportFile>[0][] = [];
  const asked: { a: number; b: number; levels: unknown }[] = [];
  const studio = {
    clipFor: vi.fn(async (ask: { a: StudioSong; b: StudioSong; levels: unknown }) => {
      asked.push({ a: ask.a.songId, b: ask.b.songId, levels: ask.levels });
      // the first boundary has a clip; the second has none, so it keeps the crossfade
      return ask.a.songId === 1 ? { status: 'clip', rendered: CLIP } : { status: 'none', reason: 'no transition', attempts: [], tookMs: 0, implementation: 'x' };
    }),
    dispose: vi.fn(),
  };
  const deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> } = {
    workspaceId: 'ws-1',
    cloud: vi.fn() as unknown as Request,
    songOf: async (songId) => ({ song: { songId, sha: sha(songId) }, data: async () => new ArrayBuffer(songId) }),
    studio: () => studio as unknown as DeviceStudio,
    decode: async (bytes) => fakeBuffer(bytes.byteLength),
    level: async (buffer) => ((buffer as unknown as { n: number }).n === 2 ? 0.5 : 1),
    link: () => 'blob:mix',
    write: vi.fn(async (options) => {
      written.push(options);
      return { ok: true, file: { format: 'flac', bytes: new Uint8Array(8), sha256: 'a'.repeat(64), durationSeconds: 359, mimeType: 'audio/flac', extension: 'flac', limiter: 'l' } } as const;
    }) as unknown as typeof exportFile,
    mix: async () => MIX,
    ...overrides,
  };
  const family = exportFamily(deps);
  const ask = <T,>(method: string, route: string, query = '', headers?: Record<string, string>) => family.answer(method, route, new URLSearchParams(query), { method, headers }) as Promise<T>;
  const jobs = async () => (await ask<{ jobs: ExportJob[] }>('GET', '/exports/jobs')).jobs;
  return { ask, jobs, written, asked, studio, deps };
}

beforeEach(() => setFlags(ON));
afterEach(() => {
  forgetExports();
  setFlags(null);
});

describe('saving a mix as a file here', () => {
  it('prepares each transition as playback plays it, then writes a checked FLAC with them, kept in memory', async () => {
    const { ask, jobs, written, asked, studio } = rig();
    const job = await ask<ExportJob>('POST', '/exports/jobs', '', { 'x-mix-order': '1,2,3' });
    expect(job).toMatchObject({ state: 'preparing', seams_total: 2, mix_name: 'Friday', scope: 'current', can_cancel: true });
    expect(job.seams.map((seam) => seam.key)).toEqual(['k1', 'k2']);
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'ready', url: 'blob:mix', seconds: 359, seams_ready: 2, can_cancel: false }));
    // each pair at the levels the songs play at
    expect(asked).toEqual([{ a: 1, b: 2, levels: { a: 1, b: 0.5 } }, { a: 2, b: 3, levels: { a: 0.5, b: 1 } }]);
    expect(studio.dispose).toHaveBeenCalled();
    const [options] = written;
    expect(options.format).toBe('flac');
    expect(options.tracks.map((track) => track.id)).toEqual([1, 2, 3]);
    expect(await options.joins!(0, fakeBuffer(1), fakeBuffer(2), { a: 1, b: 0.5 })).toBe(CLIP);
    expect(await options.joins!(1, fakeBuffer(2), fakeBuffer(3), { a: 0.5, b: 1 })).toBeNull();
    expect(await options.level!(1, fakeBuffer(2))).toBe(0.5);
  });

  it('keeps the crossfade at every boundary without the transitions flag, and still writes the file', async () => {
    setFlags({ ...ON, 'cloud.device_render': false });
    const { ask, jobs, written, studio } = rig();
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0].state).toBe('ready'));
    expect(studio.clipFor).not.toHaveBeenCalled();
    expect(await written[0].joins!(0, fakeBuffer(1), fakeBuffer(2), { a: 1, b: 1 })).toBeNull();
  });

  it('says which song is not on this device, and makes no file', async () => {
    const { ask, jobs, written } = rig({ songOf: async (songId) => (songId === 2 ? null : { song: { songId, sha: sha(songId) }, data: async () => new ArrayBuffer(1) }) });
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'failed', error: NOT_HERE('Song 2') }));
    expect(written).toHaveLength(0);
  });

  it('cancels, leaving no file', async () => {
    const dispose = vi.fn();
    const clipFor = vi.fn(() => new Promise(() => {}));
    const { ask, jobs, written } = rig({ studio: () => ({ clipFor, dispose }) as unknown as DeviceStudio });
    const job = await ask<ExportJob>('POST', '/exports/jobs');
    // a transition is in hand, and never finishes by itself
    await vi.waitFor(() => expect(clipFor).toHaveBeenCalled());
    expect((await ask<ExportJob>('DELETE', `/exports/jobs/${job.id}`)).state).toBe('cancelling');
    expect(dispose).toHaveBeenCalled();
    expect(written).toHaveLength(0);
    await vi.waitFor(async () => expect((await jobs())[0].state).toBe('cancelled'));
    expect((await jobs())[0].url).toBeUndefined();
  });

  it('refuses a mix that changed since it was shown, and a mix of one song', async () => {
    const { ask } = rig();
    await expect(ask('POST', '/exports/jobs', '', { 'x-mix-order': '3,2,1' })).rejects.toMatchObject({ code: 'mix_changed' });
    const short = rig({ mix: async () => ({ ...MIX, mix: [MIX.mix[0]] }) } as Partial<ExportDeps>);
    await expect(short.ask('POST', '/exports/jobs')).rejects.toMatchObject({ code: 'too_short' });
  });

  it('is refused with the flag off, and the shell shows it only with the flag', async () => {
    setFlags({ ...ON, 'cloud.local_export': false });
    const { ask } = rig();
    await expect(ask('GET', '/exports/jobs')).rejects.toMatchObject({ code: 'flag_off' });
    expect(browserFlags(false).export).toBe(false);
    expect(browserFlags(false, false, { localExport: true }).export).toBeUndefined();
  });

  it('names the file from the mix, with nothing but letters, digits, spaces and dashes', () => {
    expect(fileName('Friday / night: mix!', new Date('2026-11-26T10:00:00Z'))).toBe('Friday night mix 2026-11-26.flac');
    expect(fileName('***', new Date('2026-11-26T10:00:00Z'))).toBe('SelectaDJ mix 2026-11-26.flac');
  });
});
