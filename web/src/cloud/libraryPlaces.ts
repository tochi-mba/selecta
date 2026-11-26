import type { CloudCopy, PlaceCounts, SongPlacesInfo, Status } from '../api';
import type { CatalogueSong, Places } from './deviceMusicRequest';

/** library.places: the Library's filters, sorts and counts by where songs are kept (plan phase 2).
 *
 * A song can be on this device, in the cloud library, and on other devices, all at once; each
 * place is its own question, so a song in both shows under both filters. The place filters and
 * counts leave out songs set aside, as "Ready" always did; Set aside combines with a place
 * (`set_aside:cloud`). Only the adapter calls these, and only with the flag on.
 */

/** The place filters the adapter answers, besides `all`, `attention` and `set_aside`. */
export const PLACE_STATES = ['here', 'cloud', 'other', 'none'] as const;
export type PlaceState = typeof PLACE_STATES[number];

/** Each song's cloud copy, summed over the files of the song: a grouped song's copies are its
 * versions' copies. The first file's upload names it. */
export function cloudBySong(files: readonly CatalogueSong[], primaryOf: (id: number) => number): Map<number, CloudCopy> {
  const found = new Map<number, CloudCopy>();
  for (const file of [...files].sort((one, other) => one.id - other.id)) {
    if (!file.cloud) continue;
    const song = primaryOf(file.id);
    const had = found.get(song);
    if (!had) { found.set(song, { ...file.cloud }); continue; }
    found.set(song, {
      ...had, bytes: had.bytes + file.cloud.bytes, copies: had.copies + file.cloud.copies,
      // still being measured while any of its copies is
      ...(had.measuring || file.cloud.measuring ? { measuring: true } : {}),
    });
  }
  return found;
}

/** Whether another of the member's devices holds it: by name once the holdings are known, else
 * by the server's count of devices, less this one when it holds the song. */
export function onAnother(places: Places, named: boolean): boolean {
  if (places.other.online.length || places.other.before.length) return true;
  return !named && places.other.devices > (places.device ? 1 : 0);
}

/** No device holds it and there is no cloud copy. */
export function keptNowhere(places: Places, named: boolean): boolean {
  return !places.device && !places.cloud && places.other.devices === 0 && !onAnother(places, named);
}

/** Whether a song is shown under a place filter. Null: the state is not a place filter. */
export function placeMatches(state: string, song: CatalogueSong, places: Places, named: boolean): boolean | null {
  const [first, second] = state.split(':');
  const aside = first === 'set_aside';
  const place = aside ? second : first;
  if (aside && !place) return null;
  if (!(PLACE_STATES as readonly string[]).includes(place)) return null;
  if ((song.set_aside === true) !== aside) return false;
  if (place === 'here') return places.device !== null;
  if (place === 'cloud') return places.cloud;
  if (place === 'other') return onAnother(places, named);
  return keptNowhere(places, named);
}

/** The place sorts: newest added first (then the newest id), and the largest cloud copy first. */
export function placeSorter(sort: string, cloudOf: (id: number) => CloudCopy | null): ((one: CatalogueSong, other: CatalogueSong) => number) | null {
  if (sort === 'recent') return (one, other) => (other.created_at ?? 0) - (one.created_at ?? 0) || other.id - one.id;
  if (sort === 'largest') return (one, other) => (cloudOf(other.id)?.bytes ?? 0) - (cloudOf(one.id)?.bytes ?? 0) || one.title.localeCompare(other.title) || one.id - other.id;
  return null;
}

/** How many songs are kept where, set-aside songs left out. */
export function placeCounts(entries: readonly { song: CatalogueSong; places: Places }[], named: boolean): PlaceCounts {
  const counts: PlaceCounts = { here: 0, cloud: 0, both: 0, other: 0, none: 0 };
  for (const { song, places } of entries) {
    if (song.set_aside) continue;
    const here = places.device !== null;
    if (here) counts.here += 1;
    if (places.cloud) counts.cloud += 1;
    if (here && places.cloud) counts.both += 1;
    if (onAnother(places, named)) counts.other += 1;
    if (keptNowhere(places, named)) counts.none += 1;
  }
  return counts;
}

/** A Library row's places. */
export function songPlaces(places: Places, copy: CloudCopy | null): SongPlacesInfo {
  return { device: places.device, cloud: places.cloud ? copy ?? { asset_id: '', bytes: 0, format: null, copies: 1 } : null, other: places.other };
}

/** The songs a "choose your folder" banner is about: those kept on devices, not only in the cloud
 * library, and how many of them this device holds. Null without place counts. */
export function deviceSongs(status: Pick<Status, 'counts' | 'places'>): { here: number; wanted: number } | null {
  const places = status.places;
  if (!places) return null;
  const songs = status.counts.music ?? 0;
  return { here: places.here, wanted: Math.max(0, songs - (places.cloud - places.both)) };
}
