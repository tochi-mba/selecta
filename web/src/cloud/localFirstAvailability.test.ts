import { describe, expect, it, vi } from 'vitest';
import type { LibraryPage, Request } from '../api';
import { capabilities } from '../state/capabilities';
import { availabilityFacts } from '../state/availability';
import { asLibrarySong, availabilityOf, libraryPage, localFirstRequest, type CatalogueSong } from './localFirstRequest';

// BF-0462-04: the shared Library in local-first Cloud says where each catalogue song can play
// from: here, needing permission again, a hosted copy, another device, or nowhere.

const song = (id: number, title: string, available_on = 1): CatalogueSong => ({ id, title, artist: 'Artist', available_on, content_sha256: `${id}`.padStart(64, '0') });
const known = (here: [number, 'here' | 'reauth'][] = [], hosted: number[] = []) => ({ here: new Map(here), hosted: new Set(hosted) });

describe('availability of a catalogue song', () => {
  it('prefers this device, then a hosted copy, then the member’s other devices', () => {
    expect(availabilityOf(song(1, 'A'), known([[1, 'here']], [1]))).toBe('here');
    expect(availabilityOf(song(1, 'A'), known([[1, 'reauth']]))).toBe('reauth');
    // a hosted copy plays now; a lapsed permission would need the member first
    expect(availabilityOf(song(1, 'A'), known([[1, 'reauth']], [1]))).toBe('hosted');
    expect(availabilityOf(song(1, 'A', 2), known())).toBe('elsewhere');
    expect(availabilityOf(song(1, 'A', 0), known())).toBe('nowhere');
  });

  it('carries it on the Library row without claiming any analysis', () => {
    const row = asLibrarySong(song(4, 'D', 0), known());
    expect(row.availability).toBe('nowhere');
    expect(row.bpm).toBeNull();
    expect(row.readiness.status).toBe('missing');
    expect(asLibrarySong(song(5, 'E'), known([[5, 'here']])).readiness.status).toBe('analysed_incomplete');
  });

  it('filters by what the member can act on', () => {
    const songs = [song(1, 'Here'), song(2, 'Ask'), song(3, 'Away'), song(4, 'Gone', 0)];
    const where = known([[1, 'here'], [2, 'reauth']]);
    const titles = (state: string) => libraryPage(songs, new URLSearchParams({ state }), where).songs.map((row) => row.title);
    expect(titles('all')).toEqual(['Ask', 'Away', 'Gone', 'Here']);
    // nothing is analysed in the browser yet: every song is not analysed, none is ready
    expect(titles('not_yet')).toEqual(['Ask', 'Away', 'Gone', 'Here']);
    expect(titles('ready')).toEqual([]);
    expect(titles('attention')).toEqual(['Ask', 'Gone']);
  });
});

describe('the adapted request', () => {
  it('asks this device and the hosted copies afresh with each Library read', async () => {
    const cloud = vi.fn(async () => ({ songs: [song(1, 'Here'), song(2, 'Hosted', 0), song(3, 'Away')] })) as unknown as Request;
    const here = vi.fn(async () => new Map([[1, 'here' as const]]));
    const hosted = vi.fn(async (songs: readonly CatalogueSong[]) => new Set(songs.filter((one) => one.title === 'Hosted').map((one) => one.id)));
    const request = localFirstRequest(cloud, { here, hosted });
    const page = await request<LibraryPage>('/library?state=all');
    expect(page.songs.map((row) => [row.title, row.availability])).toEqual([['Away', 'elsewhere'], ['Here', 'here'], ['Hosted', 'hosted']]);
    await request<LibraryPage>('/library?state=all');
    expect(here).toHaveBeenCalledTimes(2);
  });

  it('falls back to what the catalogue knows when this device cannot be read', async () => {
    const cloud = vi.fn(async () => ({ songs: [song(1, 'A')] })) as unknown as Request;
    const request = localFirstRequest(cloud, { here: async () => { throw new Error('IndexedDB blocked'); } });
    const page = await request<LibraryPage>('/library');
    expect(page.songs[0].availability).toBe('elsewhere');
  });
});

describe('one answer for the row and the Play capability', () => {
  it('says the same thing in both places, and local songs show nothing new', () => {
    const away = asLibrarySong(song(3, 'Away'), known());
    const play = capabilities(away).find((item) => item.name === 'Play');
    expect(play).toEqual({ name: 'Play', kind: 'unavailable', words: availabilityFacts('elsewhere')!.words });
    expect(capabilities(asLibrarySong(song(1, 'Here'), known([[1, 'here']]))).find((item) => item.name === 'Play')?.kind).toBe('ready');
    expect(availabilityFacts(undefined)).toBeNull();
    const local = { bpm: 120, readiness: { status: 'mix_ready', reason: '' }, lyric_status: null, priority: false };
    expect(capabilities(local).find((item) => item.name === 'Play')?.words).toBe('The file is here and can play');
  });

  it('names every state in words a member understands', () => {
    for (const state of ['here', 'reauth', 'hosted', 'elsewhere', 'nowhere'] as const) {
      expect(availabilityFacts(state)?.words).toBeTruthy();
      expect(availabilityFacts(state)?.reason).not.toMatch(/—/);
    }
    expect(availabilityFacts('reauth')?.kind).toBe('needs-action');
  });
});
