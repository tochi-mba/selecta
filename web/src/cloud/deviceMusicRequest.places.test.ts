import { describe, expect, it } from 'vitest';
import type { SongAvailability } from '../api';
import { availabilityOf, placesOf, type Availability, type CatalogueSong } from './deviceMusicRequest';

// availabilityOf as it was before placesOf, kept here so the reduction is proven against it
function before(song: CatalogueSong, known: Availability): SongAvailability {
  const device = known.here.get(song.id);
  if (device === 'here') return 'here';
  if (known.hosted.has(song.id)) return 'hosted';
  if (device === 'reauth') return 'reauth';
  if (device === 'reconnect') return 'reconnect';
  return (song.available_on ?? 0) > 0 ? 'elsewhere' : 'nowhere';
}

const DEVICE = [undefined, 'here', 'reauth', 'reconnect'] as const;
const AVAILABLE_ON = [undefined, 0, 1, 3];
const ELSEWHERE: Availability['elsewhere'][] = [
  undefined,
  null,
  () => ({ online: [], before: [] }),
  () => ({ online: ['Laptop'], before: ['Phone'] }),
];

function cases() {
  const all: { song: CatalogueSong; known: Availability; label: string }[] = [];
  for (const device of DEVICE) for (const hosted of [false, true]) for (const availableOn of AVAILABLE_ON) for (const [at, elsewhere] of ELSEWHERE.entries()) {
    const song: CatalogueSong = { id: 7, title: 'Song', artist: 'Artist', ...(availableOn === undefined ? {} : { available_on: availableOn }) };
    const known: Availability = {
      here: new Map(device ? [[7, device]] : []),
      hosted: new Set(hosted ? [7] : []),
      ...(elsewhere === undefined ? {} : { elsewhere }),
    };
    all.push({ song, known, label: `device=${device} hosted=${hosted} available_on=${availableOn} elsewhere=${at}` });
  }
  return all;
}

describe('placesOf', () => {
  it('availabilityOf answers exactly as before for every combination of places', () => {
    const all = cases();
    expect(all).toHaveLength(4 * 2 * 4 * 4);
    for (const { song, known, label } of all) expect(availabilityOf(song, known), label).toBe(before(song, known));
  });

  it('says every place a song is kept, not only the one it plays from', () => {
    const song: CatalogueSong = { id: 7, title: 'Song', artist: 'Artist', available_on: 2 };
    const known: Availability = { here: new Map([[7, 'here']]), hosted: new Set([7]), elsewhere: () => ({ online: ['Laptop'], before: ['Phone'] }) };
    expect(placesOf(song, known)).toEqual({ device: 'here', cloud: true, other: { devices: 2, online: ['Laptop'], before: ['Phone'] } });
    // it still plays from this device first
    expect(availabilityOf(song, known)).toBe('here');
  });

  it('a song in no place has no device, no cloud copy and no other devices', () => {
    const song: CatalogueSong = { id: 9, title: 'Song', artist: 'Artist' };
    expect(placesOf(song, { here: new Map(), hosted: new Set() })).toEqual({ device: null, cloud: false, other: { devices: 0, online: [], before: [] } });
  });

  it('another song in the same answers is judged on its own', () => {
    const known: Availability = { here: new Map([[1, 'reauth']]), hosted: new Set([2]) };
    expect(placesOf({ id: 1, title: 'A', artist: 'B' }, known)).toMatchObject({ device: 'reauth', cloud: false });
    expect(placesOf({ id: 2, title: 'A', artist: 'B' }, known)).toMatchObject({ device: null, cloud: true });
  });
});
