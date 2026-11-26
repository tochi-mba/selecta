import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeamAbilities } from '../dsp/seamScript';
import { setFlags } from '../flags';
import { assertNoPath } from '../media/identity';
import { forgetAccountMeasured } from './accountFacts';
import { accountOrderPlanner } from './accountOrder';
import { accountSeamPlanner } from './accountSeams';
import { DEFAULT_STEERING } from './recipeStore';
import { planningCalls } from './studioWiring';
import { BETWEEN_SONGS_MS, startFactsUploader } from './factsUploader';
import { heldSong, measuredSong, PRIVATE_WORDS, shaOf } from './testAccountFacts';

// The privacy contract for the device-to-account requests (docs/engineering/device-to-account.md,
// "Exactly which fields leave the device"): every request this code makes is one of the routes
// listed here, and no body carries a path, a file or folder name, or anything audio-sized. No
// audio, no file path, no folder name and no file handle ever leaves the device.

/** Every request the device-to-account code may make, and nothing else. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  ['GET', /^\/song-facts\?after=\d+&limit=\d+$/],
  ['PUT', /^\/song-facts\/\d+$/],
  ['POST', /^\/planning\/order$/],
  ['POST', /^\/planning\/candidates$/],
  // cloud.device_render: one more option's script, by index; the clips themselves never leave
  ['POST', /^\/planning\/candidates\/script$/],
];

/** A path in any of its shapes: a drive, a backslash, two or more slash-separated names, or an
 * audio file's name. Base64 array data (which may hold slashes) is checked apart. */
const PATH_LIKE = /[A-Za-z]:\\|\\|\b[\w .-]+\/[\w .-]+\/|\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff?)\b/i;
const ROUTE_LEAK = /[A-Za-z]:\\|\\|\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff?)/i;
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
