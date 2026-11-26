import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeamAbilities } from '../dsp/seamScript';
import { setFlags } from '../flags';
import { assertNoPath } from '../media/identity';
import { forgetAccountMeasured } from './accountFacts';
import { accountMixes } from './accountMixes';
import { accountRequests } from './accountRequests';
import { accountPlacements } from './accountPlacements';
import { accountIdeas } from './accountIdeas';
import { accountOrderPlanner } from './accountOrder';
import { accountSeamPlanner } from './accountSeams';
import { DEFAULT_STEERING } from './recipeStore';
import { localFirstRequest } from './localFirstRequest';
import { requestsFamily } from './localFirstRequests';
import { ACCOUNT_BASE, accountDiscoveries } from './accountDiscoveries';
import { reportSeam } from './seamReports';
import { planningCalls } from './studioWiring';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { BETWEEN_SONGS_MS, startFactsUploader } from './factsUploader';
import { heldSong, measuredSong, PRIVATE_WORDS, shaOf } from './testAccountFacts';
import { beatModelManager } from '../dsp/analysis/beatThis/model';

// The privacy contract for the device-to-account requests (docs/engineering/device-to-account.md,
// "Exactly which fields leave the device"): every request this code makes is one of the routes
// listed here, and no body carries a path, a file or folder name, or anything audio-sized. No
// audio, no file path, no folder name and no file handle ever leaves the device.

/** Every request the device-to-account code may make, and nothing else. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  ['GET', /^\/song-facts\?after=\d+&limit=\d+$/],
  ['PUT', /^\/song-facts\/\d+$/],
  ['POST', /^\/planning\/order$/],
  // the account's idea cards over the songs measured here: song ids and the feel only
  ['POST', /^\/planning\/ideas$/],
  ['POST', /^\/planning\/candidates$/],
  // cloud.device_render: one more option's script, by index; the clips themselves never leave
  ['POST', /^\/planning\/candidates\/script$/],
  // cloud.device_render with cloud.brain: a report of a clip this device made, never the clip
  ['PUT', /^\/seams\/[0-9a-f]{20}$/],
  // cloud.account_mixes: the account's mix and draft routes, with catalogue ids and choices only
  ['GET', /^\/mix(\?draft=\d+)?$/],
  ['GET', /^\/drafts$/],
  ['POST', /^\/drafts$/],
  ['POST', /^\/mix\/songs$/],
  ['POST', /^\/mix\/move$/],
  ['PUT', /^\/mix\/order(\?draft=\d+)?$/],
  ['POST', /^\/mix\/\d+\/seam$/],
  // locks, with the account keeping the mix: a position, and no body at all
  ['POST', /^\/mix\/\d+\/lock$/],
  // cloud.brain with cloud.device_analysis: the member's own tempo and key for one song
  ['PUT', /^\/song-facts\/\d+\/correction$/],
  ['DELETE', /^\/song-facts\/\d+\/correction$/],
  // cloud.account_mixes: the member's own requests, by catalogue song id and request id only
  ['GET', /^\/requests$/],
  ['POST', /^\/requests$/],
  ['DELETE', /^\/requests\/\d+$/],
  // cloud.device_render with cloud.account_mixes: the account's look for where a request joins
  // and putting a ready one in: song ids, the playing position, an offer's name, the device id
  ['POST', /^\/requests\/consider\?device_id=[A-Za-z0-9_-]{1,64}$/],
  ['POST', /^\/requests\/insert\?device_id=[A-Za-z0-9_-]{1,64}$/],
  // yes or no to a bridge the account found for one of its requests: song ids only
  ['POST', /^\/requests\/\d+\/bridge$/],
  // Find a bridge: the mix's order and position, and the ids of the songs that play here
  ['POST', /^\/requests\/\d+\/bridges$/],
  // the account's harmonic discovery: a sweep names song ids and a pair limit; a review, a verdict
  ['POST', /^\/discoveries\/sweep$/],
  ['GET', /^\/discoveries\?limit=\d+$/],
  ['POST', /^\/discoveries\/\d+\/review$/],
  // the Seam Inspector: the Good or Bad of the transitions this device made, by key
  ['GET', /^\/seams\?keys=[0-9a-f]{20}(,[0-9a-f]{20})*(&device_id=[A-Za-z0-9_-]{1,64})?$/],
];

/** The one request that is not to the account: the beat tracker's model file, fetched from
 * SelectaDJ's own site at its content-hashed path (docs/engineering/device-beats.md). */
const MODEL_PATH = /^\/models\/beat-this\/web-beatthis-small0-1\/[0-9a-f]{64}\.onnx$/;

/** A path in any of its shapes: a drive, a backslash, two or more slash-separated names, or an
 * audio file's name. Base64 array data (which may hold slashes) is checked apart. */
const PATH_LIKE = /[A-Za-z]:\\|\\|\b[\w .-]+\/[\w .-]+\/|\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff?)\b/i;
const ROUTE_LEAK = /[A-Za-z]:\\|\\|\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff?)\b/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** More numbers than a beat grid could ever have: a second of audio at 8 kHz. */
const AUDIO_SIZED = 8_000;

type Captured = { method: string; path: string; body: unknown };

function capturing() {
  const calls: Captured[] = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') return { songs: [1, 2, 3, 4, 5, 6, 7].map((song_id) => ({ song_id, implementation: 'web-old-0', source: 'device' })) } as T;
    if (path === '/planning/order') return { order: [3, 2, 1, 4, 5, 6, 7] } as T;
    if (path === '/planning/candidates') return { options: [] } as T;
    return { song_id: 1, implementation: 'web-dsp-1', source: 'device' } as T;
  };
  return { calls, request };
}

/** Strings inside `value` other than the base64 array data, which is checked on its own. */
function texts(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => texts(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      if (key === 'data' && typeof inner === 'string') {
        expect(inner).toMatch(BASE64);
        continue;
      }
      texts(inner, out);
    }
  }
  return out;
}

function numbersIn(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + numbersIn(item), 0);
  if (value && typeof value === 'object') {
    const wire = value as { shape?: unknown; data?: unknown };
    if (Array.isArray(wire.shape) && typeof wire.data === 'string') return (wire.shape as number[]).reduce((total, n) => total * n, 1);
    return Object.values(value as Record<string, unknown>).reduce((total: number, item) => total + numbersIn(item), 0);
  }
  return typeof value === 'number' ? 1 : 0;
}

function holdsTheContract(call: Captured) {
  expect(ALLOWED.some(([method, path]) => method === call.method && path.test(call.path)), `${call.method} ${call.path}`).toBe(true);
  // a route has slashes of its own and is pinned by ALLOWED; what it must never carry is a
  // drive, a backslash or an audio file name
  expect(call.path).not.toMatch(ROUTE_LEAK);
  if (call.body === undefined) return;
  expect(() => assertNoPath(call.body)).not.toThrow();
  const words = texts(call.body);
  for (const word of words) expect(word).not.toMatch(PATH_LIKE);
  for (const word of PRIVATE_WORDS) expect(JSON.stringify(call.body)).not.toContain(word);
  // per array: no more values than beats; in all, far less than a second of audio
  const arrays = (call.body as { arrays?: Record<string, { shape: number[] }> }).arrays ?? {};
  for (const wire of Object.values(arrays)) expect(wire.shape.reduce((total, n) => total * n, 1)).toBeLessThan(AUDIO_SIZED);
  expect(numbersIn(call.body)).toBeLessThan(AUDIO_SIZED);
}

const ABLE: SeamAbilities = { beatmatch: { ok: true }, eqFilters: { ok: true }, stretch: { ok: true }, stems: { ok: false, reason: 'none' }, echo: { ok: true } };

beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
});
afterEach(() => setFlags(null));

describe('what the device-to-account requests carry', () => {
  it('the measurements upload: only listed routes, no path, no name, nothing audio-sized', async () => {
    const { calls, request } = capturing();
    const songs = [heldSong(1, shaOf(1)), heldSong(2, shaOf(2))];
    let parked = false;
    const stop = startFactsUploader({
      request, workspaceId: 'ws-egress', openMedia: async () => ({ all: async () => songs }),
      facts: async () => measuredSong({ bars: 96 }), memory: { read: async () => ({}), write: async () => undefined },
      wait: (ms) => (ms <= BETWEEN_SONGS_MS ? Promise.resolve() : new Promise(() => { parked = true; })), idle: async () => undefined,
    });
    try {
      await vi.waitFor(() => expect(parked).toBe(true));
    } finally {
      stop();
    }
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
    calls.forEach(holdsTheContract);
  });

  it('the order and the transition requests: song ids and choices only', async () => {
    const { calls, request } = capturing();
    const ids = [1, 2, 3, 4, 5, 6, 7];
    expect(await accountOrderPlanner(request, 'ws-egress')(ids, { start: 1, end: 7, steering: DEFAULT_STEERING })).not.toBeNull();
    const planner = accountSeamPlanner({
      request, workspaceId: 'ws-egress', fileOf: (index) => index + 1, shaOf: async (songId) => shaOf(songId),
      facts: async () => measuredSong(),
    });
    await planner({ fromIndex: 0, toIndex: 1, fromSeconds: 130, toSeconds: 130, settings: {}, abilities: ABLE });
    expect(calls.map((call) => `${call.method} ${call.path.split('?')[0]}`)).toEqual(['GET /song-facts', 'POST /planning/order', 'POST /planning/candidates']);
    calls.forEach(holdsTheContract);
    expect(Object.keys(calls[2].body as object).sort()).toEqual(['a', 'b', 'leave_after', 'scripts']);
  });

  it('the device studio\'s requests: song ids, the settle rule and an option\'s index, never audio or a clip', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true });
    const { calls, request } = capturing();
    const studio = planningCalls(request);
    await studio.candidates(1, 2);
    await studio.script(1, 2, 9, 'f'.repeat(64));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /planning/candidates', 'POST /planning/candidates/script']);
    calls.forEach(holdsTheContract);
    expect(calls[0].body).toEqual({ a: 1, b: 2, leave_after: 30, scripts: 8 });
    expect(calls[1].body).toEqual({ a: 1, b: 2, leave_after: 30, option: 9, fingerprint: 'f'.repeat(64) });
  });
});

describe('the seam report', () => {
  it('names the clip by its length and hash and carries nothing of its audio, path or name', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true });
    localStorage.setItem('selecta.device.ws-egress', 'device-1');
    const { calls, request } = capturing();
    // ten seconds of stereo audio: far more numbers than any report may carry
    const channels = [new Float32Array(441_000).fill(0.25), new Float32Array(441_000).fill(-0.25)];
    const made = {
      status: 'clip', move: 'bass_swap_blend', option: 2, passed: true, nearMiss: false, fellBack: false, beatsAligned: true,
      facts: { passed: true, failures: [] }, attempts: [], tookMs: 900, implementation: 'web-render-1+wsola-stretch-v1',
      rendered: { channels, sampleRate: 44_100, aStartSample: 4_410_000, bEndSample: 441_000, levels: { a: 1, b: 1 }, switchAt: 5, bWarp: { output: [0], source: [0] }, implementation: 'web-render-1+wsola-stretch-v1' },
    } as unknown as MadeSeam;
    const option = { move: 'bass_swap_blend', bars: 8, exit_cue: [64, 120, 'phrase', 1, 0], entry_cue: [8, 15, 'phrase', 1, 0] } as const;
    const answer = { fingerprint: 'a'.repeat(64), options: [{ index: 2, option: { ...option, exit_cue: [...option.exit_cue], entry_cue: [...option.entry_cue] } }] } as never;
    try {
      const key = await reportSeam(request, 'ws-egress', made, { a: 1, b: 2 }, answer);
      expect(key).toMatch(/^[0-9a-f]{20}$/);
      // sent once: the same clip again sends nothing
      expect(await reportSeam(request, 'ws-egress', made, { a: 1, b: 2 }, answer)).toBeNull();
    } finally {
      localStorage.removeItem('selecta.device.ws-egress');
      localStorage.removeItem('selecta.seams.reported.ws-egress');
    }
    expect(calls).toHaveLength(1);
    calls.forEach(holdsTheContract);
    const body = calls[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'a', 'a_source_start', 'audit', 'b', 'b_source_end', 'bars', 'clip_seconds', 'clip_sha256', 'device_id', 'entry_bar', 'exit_bar',
      'fell_back', 'fingerprint', 'implementation', 'move', 'near_miss', 'option', 'passed', 'tried',
    ]);
    expect(body.clip_seconds).toBe(10);
    expect(body.clip_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body).length).toBeLessThan(2_000);
  });

  it('is not sent with cloud.brain off', async () => {
    setFlags({ 'cloud.device_analysis': true, 'cloud.device_render': true });
    localStorage.setItem('selecta.device.ws-egress', 'device-1');
    const { calls, request } = capturing();
    const made = { option: 0, rendered: { channels: [new Float32Array(4)], sampleRate: 44_100 } } as unknown as MadeSeam;
    try {
      expect(await reportSeam(request, 'ws-egress', made, { a: 1, b: 2 }, { fingerprint: 'a'.repeat(64) })).toBeNull();
    } finally {
      localStorage.removeItem('selecta.device.ws-egress');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('the mixes kept with the account', () => {
  it('carry catalogue song ids, positions, names and transition choices, never a path or audio', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true });
    const { calls, request: capture } = capturing();
    // a new draft answers with its id, as the account's POST /drafts does
    const request = (async (path: string, init?: RequestInit) => {
      const answer = await capture(path, init);
      return path === '/drafts' && init?.method === 'POST' ? { id: 4, name: 'Ocean to Counting the Days' } : answer;
    }) as typeof capture;
    const mixes = accountMixes(request);
    await mixes.install('Ocean to Counting the Days', [3, 1, 2], false);
    await mixes.install('Ocean to Counting the Days', [3, 1], true);
    const send = (method: string, route: string, body?: object, query = '') =>
      mixes.answer(method, route, query, body ? { method, body: JSON.stringify(body) } : { method });
    await send('GET', '/mix');
    await send('GET', '/mix', undefined, 'draft=4');
    await send('GET', '/drafts');
    await send('POST', '/mix/songs', { song_id: 5, position: 1 });
    await send('POST', '/mix/move', { source: 0, target: 2 });
    await send('POST', '/mix/2/seam', { move: 'echo_out' });
    expect(calls.length).toBe(9);
    calls.forEach(holdsTheContract);
    expect(calls[0]).toEqual({ method: 'PUT', path: '/mix/order', body: { song_ids: [3, 1, 2], name: 'Ocean to Counting the Days' } });
  });

  it('asks nothing of the account while cloud.account_mixes is off or unnamed', () => {
    setFlags({ 'cloud.brain': true });
    const { calls, request } = capturing();
    expect(accountMixes(request).answer('GET', '/mix', '', undefined)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('the requests kept with the account', () => {
  it('carry a catalogue song id or a request id, never a path or audio', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true });
    const { calls, request: capture } = capturing();
    const request = (async (path: string, init?: RequestInit) => {
      const answer = await capture(path, init);
      return path === '/requests' && !init?.method ? { requests: [] } : answer;
    }) as typeof capture;
    const requests = accountRequests(request);
    await requests.ask(5);
    await requests.list();
    await requests.letGo(12);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /requests', 'GET /requests', 'DELETE /requests/12']);
    calls.forEach(holdsTheContract);
    expect(calls[0].body).toEqual({ song_id: 5 });
  });
});

describe('where a request joins, planned by the account', () => {
  it('carries the song ids of the mix, the playing position, an offer and the device id, never a path or audio', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true, 'cloud.device_render': true });
    localStorage.setItem('selecta.device.w1', 'dev-1');
    const { calls, request: capture } = capturing();
    const request = (async (path: string, init?: RequestInit) => {
      const answer = await capture(path, init);
      return path.startsWith('/requests/consider') ? { requests: [], settled: [] } : answer;
    }) as typeof capture;
    const placing = accountPlacements(request, 'w1');
    await placing.look({ order: [1, 2, 3], position: 0, phase: 'playing', seconds_left: 60 });
    await placing.insert({ order: [1, 2, 3], position: 0, phase: 'playing', seconds_left: 60 }, 'a'.repeat(64));
    localStorage.removeItem('selecta.device.w1');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /requests/consider?device_id=dev-1', 'POST /requests/insert?device_id=dev-1']);
    calls.forEach(holdsTheContract);
    expect(calls[0].body).toEqual({ order: [1, 2, 3], position: 0, phase: 'playing', seconds_left: 60 });
    expect(calls[1].body).toEqual({ order: [1, 2, 3], position: 0, phase: 'playing', seconds_left: 60, offer: 'a'.repeat(64) });
  });
});

describe('the account\'s idea cards', () => {
  it('carry song ids and the feel, never a path or audio', async () => {
    const { calls, request: capture } = capturing();
    const request = (async (path: string, init?: RequestInit) => {
      const answer = await capture(path, init);
      return path === '/planning/ideas' ? { ideas: [] } : answer;
    }) as typeof capture;
    const songs = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, title: `T${id}`, playable: true }));
    await accountIdeas(request, 'w1').cards(songs, 'seamless');
    expect(calls.map((call) => `${call.method} ${call.path.split('?')[0]}`)).toEqual(['GET /song-facts', 'POST /planning/ideas']);
    calls.forEach(holdsTheContract);
    expect(calls[1].body).toEqual({ songs: [1, 2, 3, 4, 5, 6, 7], language: 'seamless' });
  });
});

describe('a correction from Song details', () => {
  it('carries a tempo and a key, and nothing about the file', async () => {
    const { calls, request: capture } = capturing();
    const request = (async (path: string, init?: RequestInit) => (path.startsWith('/local-media/') ? { songs: [] } : capture(path, init))) as typeof capture;
    const adapted = localFirstRequest(request, { workspaceId: 'w1' });
    await adapted('/songs/4/correct', { method: 'POST', body: JSON.stringify({ bpm: 121.5, camelot: '8A', clear: [] }) });
    await adapted('/songs/4/correct', { method: 'POST', body: JSON.stringify({ clear: ['bpm', 'camelot'] }) });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /song-facts/4/correction', 'DELETE /song-facts/4/correction']);
    calls.forEach(holdsTheContract);
    expect(calls[0].body).toEqual({ bpm: 121.5, camelot: '8A' });
    expect(calls[1].body).toBeUndefined();
  });

  it('Is it music? carries one yes, no or none, and nothing about the file', async () => {
    const { calls, request: capture } = capturing();
    const request = (async (path: string, init?: RequestInit) => (path.startsWith('/local-media/') ? { songs: [] } : capture(path, init))) as typeof capture;
    const adapted = localFirstRequest(request, { workspaceId: 'w1' });
    await adapted('/songs/4/correct', { method: 'POST', body: JSON.stringify({ is_music: false }) });
    await adapted('/songs/4/correct', { method: 'POST', body: JSON.stringify({ is_music: true }) });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /song-facts/4/correction', 'PUT /song-facts/4/correction']);
    calls.forEach(holdsTheContract);
    expect(calls.map((call) => call.body)).toEqual([{ is_music: false }, { is_music: null }]);
  });

  it('a lock names a position and carries nothing', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true });
    const { calls, request } = capturing();
    await accountMixes(request).answer('POST', '/mix/2/lock', '', { method: 'POST' });
    expect(calls).toEqual([{ method: 'POST', path: '/mix/2/lock', body: undefined }]);
    calls.forEach(holdsTheContract);
  });
});

describe('Find a bridge', () => {
  it('carries the mix order, the position and the song ids that play here, nothing about files', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true, 'cloud.device_render': true, 'cloud.device_analysis': true, 'requests.bridges': true });
    localStorage.setItem('selecta.device.ws-1', 'dev-1');
    const calls: Captured[] = [];
    const cloud = (async (path: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/requests' && !init?.method) return { requests: [{ id: 41, song_id: 9, available: 1 }] };
      if (path === '/requests/41/bridges') return { options: [], looked_at: 3, direct: false };
      return { requests: [] };
    }) as Parameters<typeof requestsFamily>[0]['cloud'];
    const songs = async () => [1, 2, 9].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration: 200, playable: true }));
    const family = requestsFamily({ cloud, workspaceId: 'ws-1', songs, send: cloud });
    const listed = await family.answer('GET', '/requests', new URLSearchParams(), {}) as { requests: { id: number }[] };
    await family.answer('POST', `/requests/${listed.requests[0].id}/bridges`, new URLSearchParams(), { method: 'POST', body: JSON.stringify({ order: [1, 2], position: 0 }) });
    const search = calls.filter((call) => call.path === '/requests/41/bridges');
    expect(search).toHaveLength(1);
    search.forEach(holdsTheContract);
    expect(search[0].body).toEqual({ order: [1, 2], position: 0, songs: [1, 2, 9] });
    localStorage.clear();
  });
});

describe('the account harmonic discovery', () => {
  it('sends song ids and a pair limit to sweep, and a verdict to review, nothing about files', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true, 'discover.harmonic': true });
    const { calls, request } = capturing();
    const found = accountDiscoveries(request, 'ws-1');
    found.sweepSoon([1, 2, 3].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', playable: true })));
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await found.list([]);
    await found.review(ACCOUNT_BASE + 4, 'rejected');
    const sweep = calls.find((call) => call.path === '/discoveries/sweep');
    expect(sweep?.body).toEqual({ song_ids: [1, 2, 3], pair_limit: 200 });
    expect(calls.find((call) => call.path === '/discoveries/4/review')?.body).toEqual({ verdict: 'rejected' });
    expect(calls.some((call) => call.path === '/discoveries?limit=40')).toBe(true);
    calls.forEach(holdsTheContract);
  });
});

describe('the beat model fetch', () => {
  it('is one GET of the model file from this site, with nothing about a song', async () => {
    const fetched: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetched.push({ url: String(url), init });
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const noFiles = async () => ({
      getFileHandle: async () => { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); },
      removeEntry: async () => undefined,
    });
    const state = await beatModelManager({ fetchImpl, root: noFiles }).download();
    expect(state).toMatchObject({ kind: 'failed', why: 'network' });
    expect(fetched).toHaveLength(1);
    const url = new URL(fetched[0].url);
    expect(url.origin).toBe(location.origin);
    expect(url.pathname).toMatch(MODEL_PATH);
    expect(url.search).toBe('');
    expect(fetched[0].init?.method ?? 'GET').toBe('GET');
    expect(fetched[0].init?.body).toBeUndefined();
    expect(fetched[0].url).not.toMatch(ROUTE_LEAK);
  });
});
