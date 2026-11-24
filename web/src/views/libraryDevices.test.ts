import { describe, expect, it } from 'vitest';
import { libraryPage, type CatalogueSong } from '../cloud/localFirstRequest';
import type { MusicHolder, WhereHeld } from '../devices/controller';
import { deviceChip } from './LibraryRow';

// ADR-0475 R6: the Library on a device that is one of several says which device has each song,
// and "Can play now" counts songs another open device can play.

const places: WhereHeld = (id) => (id === 2 ? { online: ['Laptop'], before: [] } : id === 3 ? { online: [], before: ['Tablet'] } : { online: [], before: [] });
const holder: MusicHolder = { deviceId: 'laptop', name: 'Laptop', songs: 2, online: true, ids: new Set([2]), places };

describe('Library row status across devices', () => {
  it('names this device, the open device with the file, the one that needs its folder, or none', () => {
    expect(deviceChip(1, 'here', holder)?.words).toBe('This device');
    expect(deviceChip(2, 'elsewhere', holder)?.words).toBe('On Laptop');
    expect(deviceChip(3, 'elsewhere', holder)?.words).toBe('Needs its folder again on Tablet');
    expect(deviceChip(4, 'nowhere', holder)?.words).toBe('No device right now');
  });
  it('without another device, keeps the plain words', () => {
    expect(deviceChip(2, 'elsewhere', null)).toBeNull();
  });
});

describe('the Can play now filter', () => {
  const song = (id: number, title: string, available_on = 1): CatalogueSong => ({ id, title, artist: 'Rex', album: null, duration_s: 200, content_sha256: null, available_on } as CatalogueSong);
  it('lists songs that play here or on an open device, not ones waiting on a device', () => {
    const songs = [song(1, 'Here'), song(2, 'Laptop'), song(3, 'Tablet'), song(4, 'Gone', 0)];
    const page = libraryPage(songs, new URLSearchParams({ state: 'playable_now' }), { here: new Map([[1, 'here']]), hosted: new Set(), elsewhere: places });
    expect(page.songs.map((row) => row.title)).toEqual(['Here', 'Laptop']);
  });
});
