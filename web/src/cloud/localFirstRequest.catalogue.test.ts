import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../api';
import { CATALOGUE_CHANGED_EVENT, CATALOGUE_KEEP_MS, localFirstRequest, readCatalogue, type CatalogueSong } from './localFirstRequest';

// The browser-first catalogue was kept for 3 s, and a waiting request polled every 4 s, so every
// poll read every page of the catalogue again. It is now kept until a write or a library event
// says it changed (with a long time limit), and paging no longer stops at 20,000 songs.

function catalogue(total: number) {
  const pages: string[] = [];
  const cloud = vi.fn(async (path: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') return {} as never;
    pages.push(path);
    const after = Number(new URL(`http://x${path}`).searchParams.get('after'));
    const songs: CatalogueSong[] = [];
    for (let id = after + 1; id <= Math.min(after + 100, total); id += 1) songs.push({ id, title: `Song ${id}`, artist: 'Rex' });
    return { songs, next: after + 100 < total ? after + 100 : null } as never;
  });
  return { cloud: cloud as unknown as Request, pages };
}

afterEach(() => vi.restoreAllMocks());

describe('the catalogue is read once and kept until it changes', () => {
  it('serves status reads a minute apart from one read', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { cloud, pages } = catalogue(250);
    const request = localFirstRequest(cloud);
    await request('/status');
    const once = pages.length;
    expect(once).toBe(3);
    for (let poll = 0; poll < 15; poll += 1) { now += 4_000; await request('/status'); }
    expect(pages.length).toBe(once);
    now += CATALOGUE_KEEP_MS + 1;
    await request('/status');
    expect(pages.length).toBe(once * 2);
  });

  it('reads again after a catalogue write through it, and after a library event', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(5_000);
    const { cloud, pages } = catalogue(50);
    const request = localFirstRequest(cloud);
    await request('/status');
    await request('/local-media/songs', { method: 'POST', body: '{}' });
    await request('/status');
    expect(pages.length).toBe(2);
    window.dispatchEvent(new Event(CATALOGUE_CHANGED_EVENT));
    await request('/status');
    expect(pages.length).toBe(3);
  });
});

describe('a large catalogue', () => {
  it('is read to its last page, past 20,000 songs', async () => {
    const { cloud, pages } = catalogue(20_450);
    const songs = await readCatalogue(cloud);
    expect(songs.length).toBe(20_450);
    expect(pages.length).toBe(205);
  });

  it('stops when the server hands back a cursor that does not move on', async () => {
    const cloud = vi.fn(async () => ({ songs: [{ id: 1, title: 'One', artist: 'Rex' }], next: 0 })) as unknown as Request;
    expect((await readCatalogue(cloud)).length).toBe(1);
  });
});
