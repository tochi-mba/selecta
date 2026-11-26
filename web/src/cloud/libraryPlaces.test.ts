import { describe, expect, it } from 'vitest';
import type { LibraryPage, Request, Status } from '../api';
import { deviceMusicRequest, libraryPage, statusFrom, type Availability, type CatalogueSong } from './deviceMusicRequest';
import { cloudBySong, deviceSongs } from './libraryPlaces';
import { groupVersions } from './songVersions';

// library.places (plan phase 2): the Library's filters, sorts and counts by where songs are kept.
// A song can be on this device, in the cloud library and on another device at once; each place
// is its own filter, and a song in both shows under both.

const copy = (bytes: number, copies = 1, measuring = false) => ({ asset_id: `asset-${bytes}`, bytes, format: 'flac', copies, ...(measuring ? { measuring: true } : {}) });
const song = (id: number, title: string, extra: Partial<CatalogueSong> = {}): CatalogueSong => ({ id, title, artist: 'Rex', available_on: 0, created_at: id * 10, ...extra });

// 1 here only, 2 both, 3 cloud only, 4 on another device, 5 nowhere, 6 set aside in the cloud
const SONGS: CatalogueSong[] = [
  song(1, 'Alpha', { available_on: 1 }),
  song(2, 'Bravo', { available_on: 1, cloud: copy(9_000_000) }),
  song(3, 'Charlie', { cloud: copy(4_000_000, 2) }),
  song(4, 'Delta', { available_on: 1 }),
  song(5, 'Echo'),
  song(6, 'Foxtrot', { set_aside: true, cloud: copy(1_000_000) }),
];

function known(songs = SONGS, named = true): Availability {
  const grouping = groupVersions(songs);
  return {
    here: new Map([[1, 'here'], [2, 'here']]),
    hosted: new Set(songs.filter((one) => one.cloud).map((one) => one.id)),
    elsewhere: named ? (id) => (id === 4 ? { online: ['Laptop'], before: [] } : { online: [], before: [] }) : null,
    cloud: cloudBySong(grouping.files, grouping.primaryOf),
  };
}
const titles = (page: LibraryPage) => page.songs.map((row) => row.title);
const shown = (state: string, sort = 'title', songs = SONGS) => titles(libraryPage(songs, new URLSearchParams({ state, sort }), known(songs)));

describe('the place filters', () => {
  it('a song in both places shows under both; set-aside songs stay out of place filters', () => {
    expect(shown('here')).toEqual(['Alpha', 'Bravo']);
    expect(shown('cloud')).toEqual(['Bravo', 'Charlie']);
    expect(shown('other')).toEqual(['Delta']);
  });

  it('none is a song no device holds with no cloud copy', () => {
    expect(shown('none')).toEqual(['Echo']);
  });

  it('Set aside combines with a place', () => {
    expect(shown('set_aside')).toEqual(['Foxtrot']);
    expect(shown('set_aside:cloud')).toEqual(['Foxtrot']);
    expect(shown('set_aside:here')).toEqual([]);
  });

  it('old ready and playable_now links filter as they always did', () => {
    expect(shown('ready')).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(shown('playable_now')).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    expect(shown('all')).toHaveLength(6);
  });

  it('before the other devices are named, the server’s device count stands in', () => {
    const page = libraryPage(SONGS, new URLSearchParams({ state: 'other' }), known(SONGS, false));
    // song 1 and 2 are held here, so their one device is this one
    expect(titles(page)).toEqual(['Delta']);
  });

  it('without the flag (no cloud map) the filters are as before', () => {
    const off = { ...known(), cloud: undefined };
    // a place is no filter there: the adapter answers an unknown state as it always did
    expect(titles(libraryPage(SONGS, new URLSearchParams({ state: 'here' }), off))).toEqual([]);
    expect(titles(libraryPage(SONGS, new URLSearchParams({ state: 'ready' }), off))).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(libraryPage(SONGS, new URLSearchParams(), off).songs[0].places).toBeUndefined();
  });
});

describe('the place sorts', () => {
  it('Newest first really sorts by when the song was added, then the newest id', () => {
    expect(shown('all', 'recent')).toEqual(['Foxtrot', 'Echo', 'Delta', 'Charlie', 'Bravo', 'Alpha']);
    const tied = [song(1, 'A', { created_at: 5 }), song(2, 'B', { created_at: 5 })];
    expect(shown('all', 'recent', tied)).toEqual(['B', 'A']);
  });

  it('Largest puts the biggest cloud copy first', () => {
    expect(shown('cloud', 'largest')).toEqual(['Bravo', 'Charlie']);
  });
});

describe('a row’s places', () => {
  it('says this device, the cloud copy with its size and copies, and the other devices', () => {
    const rows = libraryPage(SONGS, new URLSearchParams(), known()).songs;
    expect(rows.find((row) => row.id === 2)?.places).toMatchObject({ device: 'here', cloud: { bytes: 9_000_000, copies: 1 } });
    expect(rows.find((row) => row.id === 3)?.places).toMatchObject({ device: null, cloud: { bytes: 4_000_000, copies: 2 } });
    expect(rows.find((row) => row.id === 4)?.places).toMatchObject({ device: null, cloud: null, other: { online: ['Laptop'] } });
  });

  it('a grouped song’s place is the union of its versions, its cloud copies summed', () => {
    const files = [
      song(10, 'Golf', { codec: 'flac', duration_s: 200, available_on: 1 }),
      song(11, 'Golf', { codec: 'mp3', duration_s: 200, duplicate_of: 10, cloud: copy(3_000_000) }),
      song(12, 'Golf', { codec: 'wav', duration_s: 200, duplicate_of: 10, cloud: copy(5_000_000, 1, true) }),
    ];
    const grouping = groupVersions(files);
    const cloud = cloudBySong(grouping.files, grouping.primaryOf);
    expect(cloud.get(10)).toEqual({ asset_id: 'asset-3000000', bytes: 8_000_000, format: 'flac', copies: 2, measuring: true });
    const page = libraryPage(grouping.songs, new URLSearchParams({ state: 'cloud' }), { here: new Map([[10, 'here']]), hosted: new Set([10]), cloud });
    expect(page.songs.map((row) => row.id)).toEqual([10]);
    expect(page.songs[0].places).toMatchObject({ device: 'here', cloud: { bytes: 8_000_000, copies: 2, measuring: true } });
  });
});

describe('the place counts', () => {
  it('counts here, cloud, both, other and none, leaving set-aside songs out', () => {
    const status: Status = statusFrom(SONGS, known());
    expect(status.places).toEqual({ here: 2, cloud: 2, both: 1, other: 1, none: 1 });
    // the folder banners count songs kept on devices: not the one only in the cloud library
    expect(deviceSongs(status)).toEqual({ here: 2, wanted: 4 });
  });

  it('without the flag there are no place counts', () => {
    expect(statusFrom(SONGS, { ...known(), cloud: undefined }).places).toBeUndefined();
    expect(deviceSongs(statusFrom(SONGS))).toBeNull();
  });
});

describe('the adapter with library.places', () => {
  it('reads the cloud copies from the songs list and answers by place', async () => {
    const asked: string[] = [];
    const cloud = (async (path: string) => {
      asked.push(path);
      if (path.startsWith('/local-media/songs')) return { songs: SONGS };
      throw new Error(`not expected: ${path}`);
    }) as Request;
    const request = deviceMusicRequest(cloud, {
      places: true, rooms: false,
      here: async () => new Map([[1, 'here'], [2, 'here']]),
      hosted: async (songs) => new Set(songs.filter((one) => one.cloud).map((one) => one.id)),
    });
    const page = await request<LibraryPage>('/library?state=cloud&sort=largest');
    expect(titles(page)).toEqual(['Bravo', 'Charlie']);
    const status = await request<Status>('/status');
    expect(status.places?.cloud).toBe(2);
    // the catalogue, and no listing of every upload
    expect(asked.every((path) => path.startsWith('/local-media/songs'))).toBe(true);
  });
});
