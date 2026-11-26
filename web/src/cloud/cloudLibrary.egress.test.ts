import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { exportFile } from '../engine/export';
import { setFlags } from '../flags';
import { assertNoPath } from '../media/identity';
import type { MediaResolver } from '../media';
import { exportFamily, forgetExports, type ExportDeps } from './localExport';
import { catalogueCopy, catalogueHeld, cloudLibraryAssets, cloudLibraryResolver, forgetCloudLibraryAssets, serverSaysCopies } from './cloudLibraryMedia';
import { deviceMusicRequest, type CatalogueSong } from './deviceMusicRequest';
import { removeFromCloud } from './libraryPlacesChrome';
import { CloudSeams } from './cloudSeams';
import { cloudExportParts } from './cloudExport';

// The cloud library's requests from the browser: every request this code makes is one of the
// routes listed here, and no body carries audio, a file or folder name, or a path. Extend ALLOWED
// with each new request a cloud library feature makes, and a case that makes it.
//
// cloud.one_mixer (Phase 4): saving a mix with cloud songs as a file here asks the account for
// nothing (the songs are read through the player's resolver, which this file stands in for); "Make
// the file in your cloud library" asks for the export by catalogue song id, then its state.

/** Every request the cloud library code here may make of the account, and nothing else. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  // cloud.one_mixer: the export by catalogue song ids, and the job it made by its id
  ['POST', /^\/hosted\/mixes\/export$/],
  ['GET', /^\/hosted\/exports\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/],
  // cloud.catalogue_play: the catalogue by page, the uploads by page (only when the server does
  // not say each song's copy), and a signed link to one upload by its id
  ['GET', /^\/local-media\/songs\?after=\d+&limit=\d+$/],
  ['GET', /^\/assets\?limit=\d+(&cursor=[A-Za-z0-9_-]+)?$/],
  ['GET', /^\/assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/playback-url$/],
  // library.places: removing songs from the cloud library, by catalogue song ids alone
  ['POST', /^\/assets\/remove$/],
  // cloud.studio_seams: one transition by its two catalogue song ids, its planned move and a lane
  ['POST', /^\/hosted\/seams$/],
];

/** The body keys each request may carry, and nothing else. */
const BODY_KEYS: Record<string, string[]> = { '/assets/remove': ['song_ids'], '/hosted/seams': ['a', 'b', 'move', 'lane'] };

const FLAGS = { 'cloud.local_export': true, 'cloud.one_mixer': true, 'cloud.hosted_render': true, 'cloud.device_render': false };
const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: null });
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2)], name: 'C:\\Users\\rex\\Music\\Friday', can_undo: false };

type Sent = { method: string; path: string; body: string };

function watched() {
  const sent: Sent[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
    return path.startsWith('/hosted/mixes/export') ? { state: 'queued', job_id: 'job-1' } : { state: 'ready', url: 'https://r2.test/mix.flac' };
  }) as Request;
  return { sent, cloud };
}

function heldTo(sent: readonly Sent[]) {
  for (const one of sent) {
    expect(ALLOWED.some(([method, path]) => method === one.method && path.test(one.path)), `${one.method} ${one.path}`).toBe(true);
    // catalogue ids and an export id only: nothing audio-sized, no file name, no path
    expect(one.body.length).toBeLessThan(4096);
    expect(one.body).not.toMatch(/\.(mp3|flac|wav|m4a|aiff?)\b|Users|Music/i);
    if (!one.body) continue;
    assertNoPath(JSON.parse(one.body));
    expect(Object.keys(JSON.parse(one.body))).toEqual(BODY_KEYS[one.path] ?? ['songs']);
  }
}

beforeEach(() => setFlags(FLAGS));
afterEach(() => {
  forgetExports();
  setFlags(null);
});

describe('the cloud library’s requests (cloud.one_mixer)', () => {
  it('saving a mix with cloud songs as a file here asks the account for nothing', async () => {
    const { sent, cloud } = watched();
    const resolver: MediaResolver = async (songId) => ({ id: songId, source: 'hosted', data: async () => new ArrayBuffer(16) });
    const deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> } = {
      workspaceId: 'ws-1', cloud, mix: async () => MIX,
      songOf: async (songId) => (songId === 1 ? { song: { songId, sha: 'a'.repeat(64) }, data: async () => new ArrayBuffer(16) } : null),
      resolve: async () => resolver,
      inCloud: async () => new Set([2, 3]),
      decode: async () => ({}) as AudioBuffer, level: async () => 1, link: () => 'blob:mix',
      write: (async (options: Parameters<typeof exportFile>[0]) => {
        for (const track of options.tracks) await track.data();
        return { ok: true, file: { format: 'flac', bytes: new Uint8Array(8), sha256: 'a'.repeat(64), durationSeconds: 1, mimeType: 'audio/flac', extension: 'flac', limiter: 'l' } } as const;
      }) as unknown as typeof exportFile,
    };
    const family = exportFamily(deps);
    await family.answer('POST', '/exports/jobs', new URLSearchParams(), { method: 'POST' });
    await vi.waitFor(async () => expect(((await family.answer('GET', '/exports/jobs', new URLSearchParams())) as { jobs: { state: string }[] }).jobs[0].state).toBe('ready'));
    expect(sent).toEqual([]);
  });

  it('making the file in the cloud library sends catalogue song ids, then follows the job by id', async () => {
    const { sent, cloud } = watched();
    const family = exportFamily({ workspaceId: 'ws-1', cloud, mix: async () => MIX, inCloud: async () => new Set([1, 2, 3]) });
    await family.answer('GET', '/exports/cloud', new URLSearchParams());
    await family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST', headers: { 'x-mix-order': '1,2,3' } });
    await family.answer('GET', '/exports/cloud/job-1', new URLSearchParams());
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['POST /hosted/mixes/export', 'GET /hosted/exports/job-1']);
    expect(JSON.parse(sent[0].body)).toEqual({ songs: [{ song_id: 1 }, { song_id: 2 }, { song_id: 3 }] });
    heldTo(sent);
  });

  it('asks for nothing when a song is outside the cloud library, or with the flag off', async () => {
    const { sent, cloud } = watched();
    const family = exportFamily({ workspaceId: 'ws-1', cloud, mix: async () => MIX, inCloud: async () => new Set([1, 3]) });
    await expect(family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST' })).rejects.toMatchObject({ code: 'not_in_cloud' });
    setFlags({ ...FLAGS, 'cloud.one_mixer': false });
    await expect(family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST' })).rejects.toMatchObject({ code: 'flag_off' });
    expect(sent).toEqual([]);
  });
});

// cloud.catalogue_play (Phase 3): a phone plays a cloud song found by its catalogue id. It reads
// the catalogue, and the uploads only when the server does not say each song's copy; it asks for
// a signed link by the upload's id; the bytes come from that link alone, with nothing sent.
describe('the cloud library’s requests (cloud.catalogue_play)', () => {
  const fetched: { url: string; init?: RequestInit }[] = [];
  beforeEach(() => {
    fetched.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { fetched.push({ url: String(url), init }); return new Response(new ArrayBuffer(8)); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function phone(rows: CatalogueSong[]) {
    forgetCloudLibraryAssets();
    const sent: Sent[] = [];
    const note = (path: string, init?: RequestInit) => sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
    const api = (async (path: string, init?: RequestInit) => {
      note(path, init);
      // a file name in an answer stays in the answer: no request below carries it
      if (path.startsWith('/assets?')) return { assets: [{ id: 'up-1', name: 'C:\\Music\\Archangel.mp3', sha256: 'b'.repeat(64) }], next_cursor: null };
      return { url: 'https://r2.test/signed?X-Amz-Signature=1', expires_in: 300 };
    }) as never;
    const cloud = (async (path: string, init?: RequestInit) => { note(path, init); return { songs: rows, next: null }; }) as Request;
    const request = deviceMusicRequest(cloud, {
      workspaceId: 'ws-phone',
      hosted: (songs) => catalogueHeld(api, 'ws-phone', songs),
      cloudCopy: async (found, all) => catalogueCopy(found, serverSaysCopies(all) ? null : await cloudLibraryAssets(api, 'ws-phone')),
    });
    return { sent, request, resolve: cloudLibraryResolver(api, 'ws-phone', { songs: () => [], assetOf: (songId) => request.cloudAssetOf(songId) }) };
  }

  it('by the song’s hash: the catalogue, the uploads, one signed link, and the bytes from that link alone', async () => {
    const { sent, request, resolve } = phone([{ id: 7, title: 'Archangel', artist: 'Burial', content_sha256: 'b'.repeat(64) }]);
    expect((await request.cloudSongs()).songs).toBe(1);
    await (await resolve(7))!.data();
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['GET /local-media/songs?after=0&limit=1000', 'GET /assets?limit=100', 'GET /assets/up-1/playback-url']);
    heldTo(sent);
    expect(sent.every((one) => one.body === '')).toBe(true);
    expect(fetched).toEqual([{ url: 'https://r2.test/signed?X-Amz-Signature=1', init: undefined }]);
  });

  it('with the server saying each song’s copy, the uploads are never listed', async () => {
    const { sent, resolve } = phone([{ id: 7, title: 'Archangel', artist: 'Burial', content_sha256: 'b'.repeat(64), cloud: { asset_id: 'up-7', bytes: 8, format: 'mp3', copies: 1 } }]);
    await (await resolve(7))!.data();
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['GET /local-media/songs?after=0&limit=1000', 'GET /assets/up-7/playback-url']);
    heldTo(sent);
    expect(fetched).toHaveLength(1);
  });
});

// library.places (Phase 2): the Library reads where songs are kept from the catalogue alone, never
// by listing the uploads, and removing songs from the cloud library sends catalogue ids only.
describe('the cloud library’s requests (library.places)', () => {
  const rows: CatalogueSong[] = [
    { id: 7, title: 'Archangel', artist: 'Burial', content_sha256: 'b'.repeat(64), cloud: { asset_id: 'up-7', bytes: 8, format: 'mp3', copies: 1 } },
    { id: 8, title: 'Archangel', artist: 'Burial', duplicate_of: 7, cloud: null },
    { id: 9, title: 'C:\Music\Near Dark.flac', artist: 'Burial', cloud: null },
  ];

  it('a Library read asks for the catalogue and nothing else', async () => {
    const sent: Sent[] = [];
    const cloud = (async (path: string, init?: RequestInit) => {
      sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
      return { songs: rows, next: null };
    }) as Request;
    const request = deviceMusicRequest(cloud, { workspaceId: 'ws-1', rooms: false, places: true, hosted: async (songs) => new Set(songs.filter((one) => one.cloud).map((one) => one.id)) });
    await request('/library?state=cloud&sort=largest');
    await request('/status');
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['GET /local-media/songs?after=0&limit=1000']);
    heldTo(sent);
  });

  it('removing songs sends their catalogue ids, every version of each, and nothing more', async () => {
    const sent: Sent[] = [];
    const cloud = (async (path: string, init?: RequestInit) => {
      sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
      if (path === '/assets/remove') return { songs: (JSON.parse(String(init?.body)).song_ids as number[]).map((id) => ({ id, found: true, removed: id === 7 ? 1 : 0, left_nowhere: false })), bytes_released: 8 };
      return { songs: rows, next: null };
    }) as Request;
    const request = deviceMusicRequest(cloud, { workspaceId: 'ws-remove', rooms: false, places: true });
    await request('/library');
    sent.length = 0;
    const answer = await removeFromCloud(cloud, 'ws-remove', [7, 9]);
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['POST /assets/remove']);
    expect(JSON.parse(sent[0].body)).toEqual({ song_ids: [7, 8, 9] });
    heldTo(sent);
    // the answer is the songs the Library shows, a grouped song's versions folded into it
    expect(answer.songs).toEqual([{ id: 7, found: true, removed: 1, left_nowhere: false }, { id: 9, found: true, removed: 0, left_nowhere: false }]);
  });
});

// cloud.studio_seams (Phase 5): playing and saving a mix whose transitions are made in the cloud
// asks the seams route by catalogue song ids, a move and a lane, and fetches only the signed links
// it answers with, sending nothing: no audio from this device, no file name, no path.
describe('the cloud library’s requests (cloud.studio_seams)', () => {
  const fetched: { url: string; init?: RequestInit }[] = [];
  const answer = {
    state: 'ready', move: 'blend', passed: true, fell_back: false, levels: { a_gain_db: -3, b_gain_db: -2 },
    files: { a: { url: 'https://r2.test/a?X-Amz-Signature=1', sha256: 'a'.repeat(64), sample_rate: 48_000, seconds: 120 }, b: { url: 'https://r2.test/b?X-Amz-Signature=1', sha256: 'b'.repeat(64), sample_rate: 44_100, seconds: 120 } },
    clip: { url: 'https://r2.test/clip?X-Amz-Signature=1', sha256: 'c'.repeat(64), a_source_start: 100, b_source_end: 4, seconds: 6, sample_rate: 44_100, switch_at: 3, b_warp: null },
  };
  beforeEach(() => {
    fetched.length = 0;
    setFlags({ ...FLAGS, 'cloud.studio_seams': true });
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { fetched.push({ url: String(url), init }); return new Response(new ArrayBuffer(8)); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const watchedSeams = () => {
    const sent: Sent[] = [];
    const cloud = (async (path: string, init?: RequestInit) => {
      sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
      return answer;
    }) as Request;
    return { sent, cloud };
  };
  const audio = { duration: 6, sampleRate: 44_100, numberOfChannels: 2, getChannelData: () => new Float32Array(6 * 44_100) };
  const anyHash = async (bytes: ArrayBuffer) => (bytes.byteLength === 8 ? 'c'.repeat(64) : '');

  it('playing: the next two seams by catalogue ids, then the clip and the songs’ files from their links', async () => {
    const { sent, cloud } = watchedSeams();
    const seams = new CloudSeams({ request: cloud, decode: async () => audio, on: () => true, sha256: anyHash, sleep: async () => undefined });
    seams.follow([{ a: 7, b: 8, move: null }, { a: 8, b: 9, move: 'echo_out' }, { a: 9, b: 10, move: null }], 0);
    const track = await seams.songAt(1, 8, async () => null);
    await vi.waitFor(() => expect(fetched.filter((one) => one.url.includes('clip'))).toHaveLength(2));
    await track!.data().catch(() => undefined);
    seams.dispose();
    expect(sent.map((one) => JSON.parse(one.body))).toEqual([
      { a: 7, b: 8, move: null, lane: 'interactive' },
      { a: 8, b: 9, move: 'echo_out', lane: 'interactive' },
    ]);
    heldTo(sent);
    // the bytes come down from the signed links alone, with nothing sent up
    expect(fetched.every((one) => one.url.startsWith('https://r2.test/') && one.init === undefined)).toBe(true);
  });

  it('saving as a file: the file’s cloud seams on the standard lane, and the links it answers with', async () => {
    const { sent, cloud } = watchedSeams();
    const parts = await cloudExportParts([{ song_id: 7 }, { song_id: 8 }, { song_id: 9 }], {
      request: cloud, inCloud: async () => new Set([7, 8]), decode: async () => audio as unknown as AudioBuffer,
      usual: async () => new ArrayBuffer(4), sha256: anyHash, connection: null,
    }, new AbortController().signal);
    await parts.songs.get(0)?.data();
    expect(sent.map((one) => JSON.parse(one.body))).toEqual([{ a: 7, b: 8, move: null, lane: 'standard' }]);
    heldTo(sent);
    expect(fetched.every((one) => one.url.startsWith('https://r2.test/') && one.init === undefined)).toBe(true);
  });

  it('asks nothing with the flag off', async () => {
    setFlags({ ...FLAGS, 'cloud.studio_seams': false });
    const { sent, cloud } = watchedSeams();
    const parts = await cloudExportParts([{ song_id: 7 }, { song_id: 8 }], { request: cloud, inCloud: async () => new Set([7, 8]), decode: async () => audio as unknown as AudioBuffer, usual: async () => new ArrayBuffer(4) }, new AbortController().signal);
    const seams = new CloudSeams({ request: cloud, decode: async () => audio });
    seams.follow([{ a: 7, b: 8, move: null }], 0);
    expect(await seams.songAt(0, 7, async () => null)).toBeNull();
    expect(parts.clips.size + sent.length + fetched.length).toBe(0);
  });
});
