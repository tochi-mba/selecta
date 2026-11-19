import { describe, expect, it, vi } from 'vitest';
import { hostedResolver, matchAsset, readHostedAssets, type HostedAsset } from './hostedMedia';

const assets: HostedAsset[] = [
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
    expect((await readHostedAssets(api, 'ws')).map((asset) => asset.id)).toEqual(['a1', 'a2']);
    const fetchBytes = vi.fn(async () => new ArrayBuffer(4));
    const resolve = hostedResolver(api, 'ws', { songs: () => [{ song_id: 7, artist: 'Burial', title: 'Archangel' }], fetchBytes });
    const track = await resolve(7);
    expect(track?.source).toBe('hosted');
    expect(calls.some((path) => path.includes('playback-url'))).toBe(false);
    expect((await track!.data()).byteLength).toBe(4);
    expect(calls).toContain('/assets/a2/playback-url');
    expect(await resolve(99)).toBeNull();
  });
});
