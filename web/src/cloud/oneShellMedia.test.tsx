import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../api';
import { setAccountFeatures, setFlags } from '../flags';
import { makeSourceBook, type MediaResolver, type MediaStore } from '../media';
import { assertNoPath } from '../media/identity';
import type { Api } from './api';
import { cloudOnlyResolver, NOT_IN_CLOUD_LIBRARY, useCloudShellMedia } from './cloudShellMedia';
import { CloudSongProblems } from './CloudSongProblems';
import { cloudOnlyOpen, musicHomesFor, oneMixerOn, oneShellFor, setShellHomes } from './musicHomes';
import type { RecipeStore } from './recipeStore';
import type { TonalStore } from './tonalProfiles';

// cloud.one_shell, cloud only: songs play from the cloud library alone, by catalogue id, and the
// device's own song index is never opened. Every request the profile makes is one of the routes
// below and carries no audio, file name or path.

/** The requests the cloud-only profile's playback and Upload music's song list may make. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  // the catalogue by page, and a signed link to one upload by its id
  ['GET', /^\/local-media\/songs\?after=\d+&limit=\d+$/],
  ['GET', /^\/assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/playback-url$/],
  // the songs that could not be analysed, and Try again for one (or, on an older server, all)
  ['GET', /^\/hosted\/songs$/],
  ['POST', /^\/hosted\/songs\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/retry$/],
  ['POST', /^\/hosted\/songs\/prepare$/],
];

type Sent = { method: string; path: string; body: string };

function allowed(sent: readonly Sent[]) {
  for (const one of sent) {
    expect(ALLOWED.some(([method, path]) => method === one.method && path.test(one.path)), `${one.method} ${one.path}`).toBe(true);
    if (one.body) assertNoPath(JSON.parse(one.body));
  }
}

afterEach(() => {
  cleanup();
  setShellHomes(null);
  setAccountFeatures(null);
  setFlags({});
  vi.unstubAllGlobals();
});

describe('cloudOnlyResolver', () => {
  const track = { id: 7, source: 'hosted' as const, data: async () => new ArrayBuffer(4) };

  it('plays a song from its cloud copy and says so in the queue', async () => {
    const book = makeSourceBook();
    const resolve = cloudOnlyResolver(async (songId) => (songId === 7 ? track : null), book);
    expect((await resolve(7))?.source).toBe('hosted');
    expect(book.get(7)).toEqual({ source: 'hosted' });
  });

  it('says a song with no cloud copy is not in the cloud library, never on this device', async () => {
    const book = makeSourceBook();
    const resolve = cloudOnlyResolver(async () => null, book);
    expect(await resolve(8)).toBeNull();
    expect(book.get(8)).toEqual({ source: 'unavailable', reason: NOT_IN_CLOUD_LIBRARY });
    const failing = cloudOnlyResolver(async () => { throw new Error('offline'); }, book);
    expect(await failing(9)).toBeNull();
    expect(book.get(9)?.source).toBe('unavailable');
  });
});

describe('the cloud-only profile in the shell media', () => {
  it('resolves by catalogue id from the cloud library and never opens this device\'s song index', async () => {
    const sent: Sent[] = [];
    const catalogue = [
      { id: 7, title: 'Blue', artist: 'Moon', available_on: 0, content_sha256: 'aa', cloud: { asset_id: 'a7', bytes: 1000, format: 'mp3', copies: 1 } },
      { id: 8, title: 'Red', artist: 'Sun', available_on: 1, content_sha256: 'bb', cloud: null },
    ];
    const answer = async (method: string, path: string, init?: RequestInit) => {
      sent.push({ method, path, body: typeof init?.body === 'string' ? init.body : '' });
      if (path.startsWith('/local-media/songs')) return { songs: catalogue };
      if (path === '/assets/a7/playback-url') return { url: 'https://store.test/a7?sig=1', expires_in: 300 };
      throw new Error(`not stubbed: ${path}`);
    };
    const cloud = (async (path: string, init?: RequestInit) => answer(init?.method ?? 'GET', path, init)) as Request;
    const api = (async (path: string, init?: RequestInit) => answer(init?.method ?? 'GET', path, init)) as Api;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    const openStore = vi.fn(async (): Promise<MediaStore> => { throw new Error('the device index was opened'); });
    const book = makeSourceBook();
    const { result } = renderHook(() => useCloudShellMedia({
      api, cloud, workspaceId: 'ws-1', on: () => true, coexisting: true, catalogue: true, devices: false, openStore,
      lapsed: { current: new Map() }, refreshStatus: { current: null }, recipes: {} as RecipeStore, browserHarmonic: false,
      tonal: {} as TonalStore, offlineShell: false, roomsHere: false, onServed: () => {}, book,
    }));
    expect((await result.current.sources.here!()).size).toBe(0);
    const resolve = (await result.current.resolver()) as MediaResolver;
    const found = await resolve(7);
    expect(found?.source).toBe('hosted');
    expect((await found!.data()).byteLength).toBe(8);
    expect(await resolve(8)).toBeNull();
    expect(book.get(8)).toEqual({ source: 'unavailable', reason: NOT_IN_CLOUD_LIBRARY });
    expect(openStore).not.toHaveBeenCalled();
    allowed(sent);
  });
});

describe('Upload music: songs that could not be analysed', () => {
  it('lists each with its reason and asks again for one, by its id alone', async () => {
    const sent: Sent[] = [];
    let failed = true;
    const api = (async (path: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? init.body : '' });
      if (path === '/hosted/songs') {
        return { songs: [
          { asset_id: 'a1', name: 'Blue.mp3', status: failed ? { state: 'failed', reason: 'The file is cut short.', can_retry: true } : { state: 'waiting' } },
          { asset_id: 'a2', name: 'Red.mp3', status: { state: 'done' } },
        ] };
      }
      if (path === '/hosted/songs/a1/retry') { failed = false; return {}; }
      throw new Error(`not stubbed: ${path}`);
    }) as Api;
    render(<CloudSongProblems api={api} workspaceId="ws-1" />);
    expect(await screen.findByRole('heading', { name: 'A song could not be analysed' })).toBeInTheDocument();
    expect(screen.getByText('The file is cut short.')).toBeInTheDocument();
    expect(screen.queryByText('Red')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try Blue again' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'A song could not be analysed' })).toBeNull());
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['GET /hosted/songs', 'POST /hosted/songs/a1/retry']);
    allowed(sent);
  });

  it('draws nothing while every song is fine or the answer cannot be read', async () => {
    const quiet = (async () => ({ songs: [{ asset_id: 'a2', name: 'Red.mp3', status: { state: 'done' } }] })) as Api;
    const { container, unmount } = render(<CloudSongProblems api={quiet} workspaceId="ws-1" />);
    await new Promise((done) => setTimeout(done, 20));
    expect(container).toBeEmptyDOMElement();
    unmount();
    const refused = (async () => { throw new Error('flag_off'); }) as Api;
    const second = render(<CloudSongProblems api={refused} workspaceId="ws-1" />);
    await new Promise((done) => setTimeout(done, 20));
    expect(second.container).toBeEmptyDOMElement();
  });
});

describe('music homes', () => {
  it('reads cloud.one_shell only where the account names it on', () => {
    expect(oneShellFor({ features: { 'cloud.one_shell': true } })).toBe(true);
    expect(oneShellFor({ features: { 'cloud.one_shell': false } })).toBe(false);
    // an older server never names it
    expect(oneShellFor({ features: {} })).toBe(false);
    expect(oneShellFor(null)).toBe(false);
  });

  it('keeps the cloud library as the one home for an account with no music on its devices', () => {
    expect(musicHomesFor({ experience: { local_first: false, hosted: true } }, false)).toEqual({ device: false, cloud: true });
    // the grant taken away, songs still stored: still cloud only
    expect(musicHomesFor({ experience: { local_first: false, hosted: false } }, false)).toEqual({ device: false, cloud: true });
    expect(musicHomesFor({ experience: { local_first: true, hosted: true } }, true)).toEqual({ device: true, cloud: true });
    expect(musicHomesFor({ experience: { local_first: true, hosted: false } }, true)).toEqual({ device: true, cloud: false });
  });

  it('gives the shared mixer to the cloud-only profile, and to anyone else only with cloud.one_mixer', () => {
    setAccountFeatures({ 'cloud.one_shell': true });
    setShellHomes({ device: false, cloud: true });
    expect(cloudOnlyOpen()).toBe(true);
    expect(oneMixerOn()).toBe(true);
    setShellHomes({ device: true, cloud: true });
    expect(cloudOnlyOpen()).toBe(false);
    expect(oneMixerOn()).toBe(false);
    setAccountFeatures({ 'cloud.one_shell': true, 'cloud.one_mixer': true });
    expect(oneMixerOn()).toBe(true);
    // never on a guess: a server that does not name cloud.one_shell leaves the profile shut
    setAccountFeatures({});
    setShellHomes({ device: false, cloud: true });
    expect(cloudOnlyOpen()).toBe(false);
    setShellHomes(null);
    setAccountFeatures({ 'cloud.one_shell': true });
    expect(cloudOnlyOpen()).toBe(false);
  });
});
