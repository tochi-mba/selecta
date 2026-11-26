import { describe, expect, it } from 'vitest';
import type { ControllerLink } from '../devices/controller';
import type { CatalogueSong } from './deviceMusicRequest';
import { groupVersions, hereBySong, linkBySong, rememberGrouping, setBySong, whereBySong, withVersions } from './songVersions';

// ADR-0469 amendment 2: one song, however many files of it. The catalogue lists every file; the
// browser shows one row per song under its primary id, and plays the best version it holds.

const row = (id: number, extra: Partial<CatalogueSong> = {}): CatalogueSong => ({ id, title: 'Agora Hills', artist: 'Doja Cat', duration_s: 265, codec: 'mp3', ...extra });

const files = [
  row(2447, { available_on: 1 }),
  row(3271, { duplicate_of: 2447, codec: 'flac', available_on: 2 }),
  row(3296, { duplicate_of: 2447 }),
  row(3300, { duration_s: 340 }),
  row(10, { title: 'Ocean', artist: 'Ella Vos' }),
];

describe('grouping the catalogue', () => {
  it('lists one row per song under its primary id, with every version', () => {
    const grouping = groupVersions(files);
    expect(grouping.songs.map((song) => song.id).sort((a, b) => a - b)).toEqual([10, 2447, 3300]);
    const agora = grouping.songs.find((song) => song.id === 2447)!;
    expect(agora.versions).toEqual([2447, 3271, 3296]);
    // devices: the most any version is on
    expect(agora.available_on).toBe(2);
    expect(grouping.files).toHaveLength(5);
  });

  it('reads any version id as its song, and offers the best version first', () => {
    const grouping = groupVersions(files);
    expect(grouping.primaryOf(3296)).toBe(2447);
    expect(grouping.primaryOf(3300)).toBe(3300);
    // lossless first
    expect(grouping.versionsOf(2447)[0]).toBe(3271);
    expect(new Set(grouping.versionsOf(3296))).toEqual(new Set([2447, 3271, 3296]));
    expect(grouping.versionsOf(999)).toEqual([999]);
  });

  it('keeps a version whose primary was removed as a song of its own', () => {
    const grouping = groupVersions([row(5, { duplicate_of: 4 })]);
    expect(grouping.songs.map((song) => song.id)).toEqual([5]);
  });

  it('says Never play for the song when any version is marked', () => {
    const grouping = groupVersions([row(1), row(2, { duplicate_of: 1, never: true })]);
    expect(grouping.songs[0].never).toBe(true);
  });
});

describe('availability and devices by song', () => {
  const grouping = groupVersions(files);

  it('takes the best answer across versions', () => {
    const here = hereBySong(grouping, new Map([[2447, 'reconnect'], [3296, 'here']] as const));
    expect(here.get(2447)).toBe('here');
    expect(setBySong(grouping, new Set([3271]))).toEqual(new Set([2447]));
  });

  it('places a song on any device holding a version of it', () => {
    const where = whereBySong(grouping, (id) => (id === 3296 ? { online: ['Phone'], before: [] } : { online: [], before: id === 2447 ? ['Laptop'] : [] }))!;
    expect(where(2447)).toEqual({ online: ['Phone'], before: ['Laptop'] });
  });

  it('matches a request against the speaker whichever version it holds', () => {
    const link = { speakerName: 'Laptop', online: true, programme: [3296, 10], songIndex: 0, holds: new Set([3296]), send: async () => true } as ControllerLink;
    const bySong = linkBySong(grouping, link)!;
    expect(bySong.programme).toEqual([2447, 10]);
    expect(bySong.holds).toEqual(new Set([2447]));
  });
});

describe('playing a song from whichever version this device holds', () => {
  it('tries the best version first and answers with the asked id', async () => {
    rememberGrouping('ws-versions', groupVersions(files));
    const asked: number[] = [];
    const resolve = withVersions(async (id) => {
      asked.push(id);
      return id === 3296 ? { id, data: async () => new ArrayBuffer(1) } : null;
    }, 'ws-versions');
    const found = await resolve(2447);
    expect(found?.id).toBe(2447);
    expect(asked[0]).toBe(3271);
    expect(asked).toContain(3296);
  });

  it('is an honest null when no version is here', async () => {
    rememberGrouping('ws-versions', groupVersions(files));
    expect(await withVersions(async () => null, 'ws-versions')(10)).toBeNull();
  });
});
