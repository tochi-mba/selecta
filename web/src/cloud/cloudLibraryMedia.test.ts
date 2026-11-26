import { describe, expect, it, vi } from 'vitest';
import type { Request } from '../api';
import { catalogueCopy, catalogueHeld, cloudLibraryAssets, cloudLibraryResolver, forgetCloudLibraryAssets, matchAsset, readCloudLibraryAssets, serverSaysCopies, type CloudLibraryAsset } from './cloudLibraryMedia';
import { deviceMusicRequest, type CatalogueSong } from './deviceMusicRequest';

const assets: CloudLibraryAsset[] = [
  { id: 'a1', name: 'Song 1.wav', sha256: 'aa' },
  { id: 'a2', name: 'Burial - Archangel.mp3', sha256: 'bb' },
  { id: 'a3', name: 'Intro.flac', sha256: 'cc' },
  { id: 'a4', name: 'Intro.mp3', sha256: 'dd' },
];

describe('matching a catalogue song to its hosted copy', () => {
  it('matches by content first, whatever the names say', () => {
    expect(matchAsset({ song_id: 1, title: 'Something else' }, 'BB', assets)?.id).toBe('a2');
  });

  it('matches an exact "Artist - Title" or title file name, case and extension aside', () => {
    expect(matchAsset({ song_id: 1, artist: 'Burial', title: 'Archangel' }, null, assets)?.id).toBe('a2');
    expect(matchAsset({ song_id: 1, artist: '', title: 'song 1' }, null, assets)?.id).toBe('a1');
  });

  it('refuses an uncertain match rather than play the wrong song', () => {
    expect(matchAsset({ song_id: 1, title: 'Intro' }, null, assets)).toBeNull();
    expect(matchAsset({ song_id: 1, title: 'Archangel (VIP)' }, null, assets)).toBeNull();
    expect(matchAsset({ song_id: 1, title: '' }, null, assets)).toBeNull();
  });
});

describe('the hosted resolver', () => {
  it('reads every page, and signs the playback URL only when the bytes are wanted', async () => {
    const calls: string[] = [];
    const api = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.startsWith('/assets?') && !path.includes('cursor')) return { assets: [assets[0]], next_cursor: 'c2' };
      if (path.startsWith('/assets?')) return { assets: [assets[1]], next_cursor: null };
      return { url: `https://signed.example/${path}` };
    }) as never;
    expect((await readCloudLibraryAssets(api, 'ws')).map((asset) => asset.id)).toEqual(['a1', 'a2']);
    const fetchBytes = vi.fn(async () => new ArrayBuffer(4));
    const resolve = cloudLibraryResolver(api, 'ws', { songs: () => [{ song_id: 7, artist: 'Burial', title: 'Archangel' }], fetchBytes });
    const track = await resolve(7);
    expect(track?.source).toBe('hosted');
    expect(calls.some((path) => path.includes('playback-url'))).toBe(false);
    expect((await track!.data()).byteLength).toBe(4);
    expect(calls).toContain('/assets/a2/playback-url');
    expect(await resolve(99)).toBeNull();
  });
});

// cloud.catalogue_play: a song's upload found from the catalogue by id, as CloudShell wires it
// (cloudShellMedia.ts), with no device index and whatever the programme is
function byCatalogue(workspaceId: string, rows: CatalogueSong[]) {
  forgetCloudLibraryAssets();
  const calls: string[] = [];
  const api = vi.fn(async (path: string) => {
    calls.push(path);
    if (path.startsWith('/assets?')) return { assets, next_cursor: null };
    return { url: `https://signed.example${path}`, expires_in: 300 };
  }) as never;
  const cloud = (async (path: string) => {
    calls.push(path);
    return path.startsWith('/local-media/songs') ? { songs: rows, next: null } : {};
  }) as Request;
  const request = deviceMusicRequest(cloud, {
    workspaceId,
    hosted: (songs) => catalogueHeld(api, workspaceId, songs),
    cloudCopy: async (found, all) => catalogueCopy(found, serverSaysCopies(all) ? null : await cloudLibraryAssets(api, workspaceId)),
  });
  const fetchBytes = vi.fn(async () => new ArrayBuffer(8));
  const resolve = cloudLibraryResolver(api, workspaceId, { songs: () => [], assetOf: (songId) => request.cloudAssetOf(songId), fetchBytes });
  return { calls, resolve, request, fetchBytes };
}

const row = (id: number, title: string, sha: string, over: Partial<CatalogueSong> = {}): CatalogueSong => ({ id, title, artist: 'Burial', content_sha256: sha, ...over });

describe('a cloud song found by its catalogue id (cloud.catalogue_play)', () => {
  it('plays a song outside the programme on a device that never held it, by its hash, never its name', async () => {
    const { calls, resolve } = byCatalogue('ws-cat-1', [
      row(7, 'Archangel', 'BB'),
      // named exactly as an upload, but no upload has its hash: not this song
      row(8, 'Song 1', 'ee', { artist: '' }),
      // a song whose best version is the one in the cloud library
      row(9, 'Ghost', 'f1'),
      row(10, 'Ghost', 'cc', { duplicate_of: 9, codec: 'flac' }),
    ]);
    const track = await resolve(7);
    expect(track?.source).toBe('hosted');
    expect(calls.some((path) => path.includes('playback-url'))).toBe(false);
    expect((await track!.data()).byteLength).toBe(8);
    expect(calls).toContain('/assets/a2/playback-url');
    expect(await resolve(8)).toBeNull();
    await (await resolve(9))!.data();
    expect(calls).toContain('/assets/a3/playback-url');
  });

  it('takes the server’s own answer when it sends one, and then lists no uploads', async () => {
    const { calls, resolve } = byCatalogue('ws-cat-2', [
      row(7, 'Archangel', 'zz', { cloud: { asset_id: 'kept-7', bytes: 10, format: 'flac', copies: 1 } }),
      row(8, 'Song 1', 'aa'),
    ]);
    await (await resolve(7))!.data();
    expect(calls).toContain('/assets/kept-7/playback-url');
    // the server says which songs have a copy, so a song it lists without one has none here
    expect(await resolve(8)).toBeNull();
    expect(calls.some((path) => path.startsWith('/assets?'))).toBe(false);
  });

  it('says which songs are in the cloud library: every version’s id, and how many songs', async () => {
    const { request } = byCatalogue('ws-cat-3', [row(7, 'Archangel', 'bb'), row(9, 'Ghost', 'f1'), row(10, 'Ghost', 'cc', { duplicate_of: 9 }), row(11, 'Other', '00')]);
    const found = await request.cloudSongs();
    expect([...found.ids].sort((one, other) => one - other)).toEqual([7, 9, 10]);
    expect(found.songs).toBe(2);
  });
});

describe('signed links (cloud.catalogue_play)', () => {
  it('signs when the bytes are wanted, keeps the link while good, and signs again once it ran out or storage refused it', async () => {
    let now = 0;
    let signs = 0;
    const api = vi.fn(async () => { signs += 1; return { url: `https://signed.example/${signs}`, expires_in: 300 }; }) as never;
    const fetchBytes = vi.fn(async (_url: string) => new ArrayBuffer(4));
    const resolve = cloudLibraryResolver(api, 'ws-sign', { songs: () => [], assetOf: async () => 'up-9', fetchBytes, now: () => now });
    const track = (await resolve(1))!;
    expect(signs).toBe(0);
    await track.data();
    // a seek a minute later reads the same link
    now = 60_000;
    await track.data();
    expect(signs).toBe(1);
    // a long pause: the link ran out, so it is signed again before the bytes are asked for
    now = 301_000;
    await track.data();
    expect(signs).toBe(2);
    expect(fetchBytes).toHaveBeenLastCalledWith('https://signed.example/2');
    // storage refused a link that looked good (a song that started after it expired): once more
    fetchBytes.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 403 }));
    await track.data();
    expect(signs).toBe(3);
    expect(fetchBytes).toHaveBeenLastCalledWith('https://signed.example/3');
    // any other failure is said, not retried
    fetchBytes.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 500 }));
    await expect(track.data()).rejects.toThrow('gone');
    expect(signs).toBe(3);
  });
});
