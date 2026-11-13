import { describe, expect, it } from 'vitest';
import type { Api } from './api';
import { assetCatalogue, CATALOGUE_PAGE_SIZE, catalogueSource } from './cloudCatalogue';
import { librarySource } from '../rooms/CloudListen';

// AV-0419-04: Listen's catalogue reads every page by cursor and addresses songs by asset id.

type Song = { id: string; name: string };
const library = (count: number): Song[] => Array.from({ length: count }, (_, at) => ({ id: `a${at + 1}`, name: `Song ${at + 1}.wav` }));

/** A fake of GET /assets as src/selecta/routes/cloud_assets.py serves it: newest first, at most
 * 100 a page (a larger limit is refused, as FastAPI's le=100 does), with an opaque cursor. */
function server(songs: () => Song[]) {
  const asked: string[] = [];
  const api = (async (path: string) => {
    asked.push(path);
    const url = new URL(path, 'http://x');
    if (url.pathname.endsWith('/playback-proxy')) return { status: 'ready', url: `https://r2.test/${url.pathname.split('/')[2]}` };
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (limit > CATALOGUE_PAGE_SIZE) throw Object.assign(new Error('Request failed (422).'), { status: 422 });
    const newest = songs().slice().reverse();
    const from = Number(url.searchParams.get('cursor') ?? 0);
    const page = newest.slice(from, from + limit);
    return { assets: page, next_cursor: from + limit < newest.length ? String(from + limit) : null };
  }) as Api;
  return { api, asked };
}

describe('the Cloud catalogue (AV-0419-04)', () => {
  it('reproduces the old fault: one page of limit=200 is refused by the server', async () => {
    const { api } = server(() => library(250));
    const old = librarySource(api, 'ws');
    await expect(old.source(0)).rejects.toThrow('422');
  });

  it('reads every page by cursor, oldest first, past 200 songs', async () => {
    const { api, asked } = server(() => library(250));
    const catalogue = assetCatalogue(api, 'ws');
    const all = await catalogue.list();
    expect(all).toHaveLength(250);
    expect(all[0]?.id).toBe('a1');
    expect(all[249]?.id).toBe('a250');
    expect(await catalogue.idAt(230)).toBe('a231');
    expect(asked.filter((path) => path.startsWith('/assets?'))).toHaveLength(3);
    expect(asked.some((path) => path.includes('cursor='))).toBe(true);
    expect(asked.every((path) => !path.includes('limit=200'))).toBe(true);
  });

  it('keeps a played position pinned to its asset id when the library changes', async () => {
    let songs = library(5);
    const { api } = server(() => songs);
    const catalogue = assetCatalogue(api, 'ws');
    expect(await catalogue.idAt(2)).toBe('a3');
    songs = songs.filter((song) => song.id !== 'a1');
    catalogue.refresh();
    expect(await catalogue.idAt(2)).toBe('a3');
    expect(catalogue.name(2)).toBe('Song 3.wav');
    expect(await catalogue.indexOf('a5')).toBe(3);
  });

  it('a new upload lands at the end and moves no existing position', async () => {
    let songs = library(3);
    const { api } = server(() => songs);
    const catalogue = assetCatalogue(api, 'ws');
    expect(await catalogue.indexOf('a2')).toBe(1);
    songs = [...songs, { id: 'a4', name: 'Song 4.wav' }];
    catalogue.refresh();
    expect(await catalogue.indexOf('a2')).toBe(1);
    expect(await catalogue.indexOf('a4')).toBe(3);
  });

  it('plays a session position from the asset id, and nothing past the end', async () => {
    const { api } = server(() => library(220));
    const { source } = catalogueSource(api, 'ws');
    expect(await source(210)).toBe('https://r2.test/a211');
    expect(await source(220)).toBeNull();
  });

  it('stops instead of looping when a server repeats a cursor', async () => {
    const api = (async () => ({ assets: [{ id: 'x', name: 'X' }], next_cursor: 'same' })) as Api;
    expect(await assetCatalogue(api, 'ws').list()).toHaveLength(2);
  });
});
