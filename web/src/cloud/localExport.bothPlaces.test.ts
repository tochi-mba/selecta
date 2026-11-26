import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportJob, MixData, MixItem, Request } from '../api';
import type { exportFile } from '../engine/export';
import { setFlags } from '../flags';
import type { MediaResolver, ResolvedTrack } from '../media';
import type { DeviceStudio } from './deviceStudio';
import { exportFamily, forgetExports, NOT_HERE, ON_DEVICE, TOO_FEW, type ExportDeps } from './localExport';
import { NOT_IN_CLOUD, ownCloudCopies } from './cloudFileExport';
import type { CatalogueSong } from './deviceMusicRequest';
import { groupVersions } from './songVersions';

// Phase 4 (cloud.one_mixer): a mix with songs on this device and in the cloud library saves as a
// file here, reading the cloud songs to this device through the player's resolver; a song only
// on another device is left out by name; and a mix whose every song is in the cloud library is
// offered "Make the file in your cloud library".

const ON = { 'cloud.local_export': true, 'cloud.device_render': true, 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.one_mixer': true, 'cloud.hosted_render': true };
const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: position ? { settings: {}, state: { status: 'none', key: `k${position}` } } : null });
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2)], name: 'Friday', can_undo: false };
const sha = (n: number) => n.toString(16).padStart(64, '0');
const fakeBuffer = (n: number) => ({ n }) as unknown as AudioBuffer;

/** Songs 1 and 3 are files here; song 2 is read through the resolver when `cloud` holds it. */
function rig({ cloudSongs = [2], held = {} as Record<number, string>, inCloud = [] as number[], here = [1, 3] } = {}) {
  const written: Parameters<typeof exportFile>[0][] = [];
  const read: number[] = [];
  const cloud = vi.fn(async (path: string) => ({ state: 'queued', job_id: 'job-1', path })) as unknown as Request & ReturnType<typeof vi.fn>;
  const studio = { clipFor: vi.fn(async () => ({ status: 'none', reason: 'none', attempts: [], tookMs: 0, implementation: 'x' })), dispose: vi.fn() };
  const resolver: MediaResolver = async (songId) => {
    if (!cloudSongs.includes(songId)) return null;
    return { id: songId, source: 'hosted', data: async () => { read.push(songId); return new ArrayBuffer(songId); } } satisfies ResolvedTrack;
  };
  const deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> } = {
    workspaceId: 'ws-1',
    cloud,
    songOf: async (songId) => (here.includes(songId) ? { song: { songId, sha: sha(songId) }, data: async () => new ArrayBuffer(songId) } : null),
    resolve: async () => resolver,
    heldBy: (songId) => held[songId] ?? null,
    inCloud: async () => new Set(inCloud),
    studio: () => studio as unknown as DeviceStudio,
    decode: async (bytes) => fakeBuffer(bytes.byteLength),
    level: async () => 1,
    link: () => 'blob:mix',
    write: vi.fn(async (options) => {
      written.push(options);
      for (const track of options.tracks) await track.data();
      return { ok: true, file: { format: 'flac', bytes: new Uint8Array(8), sha256: 'a'.repeat(64), durationSeconds: 300, mimeType: 'audio/flac', extension: 'flac', limiter: 'l' } } as const;
    }) as unknown as typeof exportFile,
    mix: async () => MIX,
  };
  const family = exportFamily(deps);
  const ask = <T,>(method: string, route: string, query = '', headers?: Record<string, string>) => family.answer(method, route, new URLSearchParams(query), { method, headers }) as Promise<T>;
  const jobs = async () => (await ask<{ jobs: ExportJob[] }>('GET', '/exports/jobs')).jobs;
  return { ask, jobs, written, read, cloud, studio };
}

beforeEach(() => setFlags(ON));
afterEach(() => {
  forgetExports();
  setFlags(null);
});

describe('a file from songs in both places (cloud.one_mixer)', () => {
  it('saves a mixed mix, reading the cloud song to this device and asking nothing of the account', async () => {
    const { ask, jobs, written, read, cloud, studio } = rig();
    await ask('POST', '/exports/jobs', '', { 'x-mix-order': '1,2,3' });
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'ready', url: 'blob:mix', seams_ready: 2, error: null }));
    expect(written[0].tracks.map((track) => track.id)).toEqual([1, 2, 3]);
    expect(read).toEqual([2]);
    // each transition touches the cloud song, so each is joined as playback blends it live
    expect(studio.clipFor).not.toHaveBeenCalled();
    expect(await written[0].joins!(0, fakeBuffer(1), fakeBuffer(2), { a: 1, b: 1 })).toBeNull();
    // nothing leaves the device: the export made no request of the account
    expect(cloud).not.toHaveBeenCalled();
  });

  it('still makes transitions between two songs on this device', async () => {
    const { ask, jobs, studio } = rig({ cloudSongs: [3], here: [1, 2] });
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0].state).toBe('ready'));
    expect(studio.clipFor).toHaveBeenCalledTimes(1);
  });

  it('leaves out a song that is only on another device, by that device’s name, and saves the rest', async () => {
    const { ask, jobs, written } = rig({ cloudSongs: [], held: { 2: 'Laptop' } });
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'ready', error: ON_DEVICE('Song 2', 'Laptop'), seams_total: 1 }));
    expect(written[0].tracks.map((track) => track.id)).toEqual([1, 3]);
  });

  it('makes no file when fewer than two songs can be read here', async () => {
    const { ask, jobs, written } = rig({ cloudSongs: [], here: [1], held: { 2: 'Laptop', 3: 'Phone' } });
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'failed', error: `${ON_DEVICE('Song 2', 'Laptop')} ${ON_DEVICE('Song 3', 'Phone')} ${TOO_FEW}` }));
    expect(written).toHaveLength(0);
  });

  it('with the flag off, refuses a song not on this device exactly as before', async () => {
    setFlags({ ...ON, 'cloud.one_mixer': false });
    const { ask, jobs, written, read } = rig();
    await ask('POST', '/exports/jobs');
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ state: 'failed', error: NOT_HERE('Song 2') }));
    expect(written).toHaveLength(0);
    expect(read).toEqual([]);
  });
});

describe('Make the file in your cloud library', () => {
  it('is offered only when every song is in the cloud library', async () => {
    expect(await rig({ inCloud: [1, 2, 3] }).ask('GET', '/exports/cloud')).toEqual({ offered: true });
    expect(await rig({ inCloud: [2] }).ask('GET', '/exports/cloud')).toEqual({ offered: false });
  });

  it('asks for the file by catalogue song id, then follows the job by its id', async () => {
    const { ask, cloud } = rig({ inCloud: [1, 2, 3] });
    await ask('POST', '/exports/cloud', '', { 'x-mix-order': '1,2,3' });
    expect(cloud).toHaveBeenCalledWith('/hosted/mixes/export', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String(cloud.mock.calls[0][1].body));
    expect(body).toEqual({ songs: [{ song_id: 1 }, { song_id: 2 }, { song_id: 3 }] });
    await ask('GET', '/exports/cloud/job-1');
    expect(cloud).toHaveBeenLastCalledWith('/hosted/exports/job-1');
  });

  it('refuses a mix with a song outside the cloud library, a changed mix, and the flag off', async () => {
    const { ask, cloud } = rig({ inCloud: [1, 3] });
    await expect(ask('POST', '/exports/cloud')).rejects.toMatchObject({ code: 'not_in_cloud', message: NOT_IN_CLOUD('Song 2') });
    await expect(rig({ inCloud: [1, 2, 3] }).ask('POST', '/exports/cloud', '', { 'x-mix-order': '3,2,1' })).rejects.toMatchObject({ code: 'mix_changed' });
    expect(cloud).not.toHaveBeenCalled();
    setFlags({ ...ON, 'cloud.one_mixer': false });
    await expect(rig({ inCloud: [1, 2, 3] }).ask('GET', '/exports/cloud')).rejects.toMatchObject({ code: 'flag_off' });
  });

  describe('a song with two versions, only the other one in the cloud library', () => {
    // song 1 is the song a mix plays; 5 is another file of it (a version), and only 5 was
    // uploaded. Its Library row shows both places, but the server's export reads song 1's own
    // copy (`cloud_copies`), and it has none.
    const copy = (asset_id: string) => ({ asset_id, bytes: 100, format: 'flac', copies: 1 });
    const rows: CatalogueSong[] = [
      { id: 1, title: 'Song 1', artist: 'Rex', content_sha256: sha(1) },
      { id: 2, title: 'Song 2', artist: 'Rex', content_sha256: sha(2), cloud: copy('a2') },
      { id: 5, title: 'Song 1', artist: 'Rex', content_sha256: sha(5), duplicate_of: 1, cloud: copy('a5') },
    ];
    const grouping = groupVersions(rows);
    const two: MixData = { ...MIX, mix: [item(1, 0), item(2, 1)] };
    const family = (files: CatalogueSong[], cloudCopy?: (rows: readonly CatalogueSong[], all: readonly CatalogueSong[]) => Promise<string | null>) => {
      const cloud = vi.fn(async () => ({ state: 'queued', job_id: 'job-1' }));
      const made = exportFamily({ workspaceId: 'ws-1', cloud: cloud as unknown as Request, mix: async () => two, inCloud: (ids) => ownCloudCopies(files, ids, cloudCopy) });
      const ask = <T,>(method: string, route: string) => made.answer(method, route, new URLSearchParams(), { method }) as Promise<T>;
      return { ask, cloud };
    };

    it('is not offered, and the server’s refusal is never reached', async () => {
      expect(grouping.primaryOf(5)).toBe(1);
      const { ask, cloud } = family(grouping.files);
      expect(await ask('GET', '/exports/cloud')).toEqual({ offered: false });
      await expect(ask('POST', '/exports/cloud')).rejects.toMatchObject({ code: 'not_in_cloud', message: NOT_IN_CLOUD('Song 1') });
      expect(cloud).not.toHaveBeenCalled();
      // the song's own copy is what counts: with it, the file is offered
      const own = grouping.files.map((row) => (row.id === 1 ? { ...row, cloud: copy('a1') } : row));
      expect(await family(own).ask('GET', '/exports/cloud')).toEqual({ offered: true });
    });

    it('without the server’s answer, asks for the song’s own row alone, never a version’s', async () => {
      const bare = grouping.files.map((row) => ({ ...row, cloud: undefined }));
      const asked: number[][] = [];
      const byHash = async (looked: readonly CatalogueSong[]) => {
        asked.push(looked.map((row) => row.id));
        return looked.some((row) => row.id === 2 || row.id === 5) ? 'asset' : null;
      };
      const { ask, cloud } = family(bare, byHash);
      expect(await ask('GET', '/exports/cloud')).toEqual({ offered: false });
      expect(asked).toEqual([[1], [2]]);
      // and with no way to tell, nothing is offered
      expect(await family(bare).ask('GET', '/exports/cloud')).toEqual({ offered: false });
      expect(cloud).not.toHaveBeenCalled();
    });
  });

  it('answers nothing without the cloud library list, so the panel offers nothing', () => {
    const family = exportFamily({ workspaceId: 'ws-1', cloud: vi.fn() as unknown as Request, mix: async () => MIX });
    expect(family.answer('GET', '/exports/cloud', new URLSearchParams())).toBeUndefined();
  });
});
