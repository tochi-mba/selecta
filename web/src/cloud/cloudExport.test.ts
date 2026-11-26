import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { exportFile } from '../engine/export';
import { setFlags } from '../flags';
import { bytesSha256 } from '../media/identity';
import type { DeviceStudio } from './deviceStudio';
import { exportFamily, forgetExports, type ExportDeps } from './localExport';
import { gainOf } from './cloudSeams';

// cloud.studio_seams: a mix saved as a file joins a transition made in the cloud exactly as
// playback does: the clip counted in samples at the export's decode rate, the songs next to it
// read from their lossless files at the clip's levels, and the device studio kept off those seams.

const ON = { 'cloud.local_export': true, 'cloud.device_render': true, 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.one_mixer': true, 'cloud.hosted_render': true, 'cloud.studio_seams': true };
const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: position ? { settings: {}, state: { status: 'none', key: `k${position}` } } : null });
// songs 1 and 2 are here and in the cloud library; 3 and 4 only here
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2), item(4, 3)], name: 'Friday', can_undo: false };
const sha = (n: number) => n.toString(16).padStart(64, '0');
const RATE = 44_100;
const CLIP = 99;
const LOSSLESS = { a: 101, b: 102 } as const;
const hashes: Record<number, string> = {};

beforeAll(async () => {
  for (const size of [CLIP, LOSSLESS.a, LOSSLESS.b]) hashes[size] = await bytesSha256(new ArrayBuffer(size));
});

function rig() {
  const written: Parameters<typeof exportFile>[0][] = [];
  const asked: { method: string; path: string; body: string }[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    asked.push({ method: init?.method ?? 'GET', path, body: String(init?.body ?? '') });
    if (path !== '/hosted/seams') return { state: 'queued', job_id: 'job-1' };
    return {
      state: 'ready', move: 'bass_swap_blend', passed: true, fell_back: false,
      files: {
        a: { url: 'https://r2.test/a.flac?sig=1', sha256: hashes[LOSSLESS.a], sample_rate: 48_000, seconds: 120 },
        b: { url: 'https://r2.test/b.flac?sig=1', sha256: hashes[LOSSLESS.b], sample_rate: 44_100, seconds: 120 },
      },
      clip: { url: 'https://r2.test/clip.flac?sig=1', sha256: hashes[CLIP], a_source_start: 100, b_source_end: 4, seconds: 6, sample_rate: 44_100, switch_at: 3, b_warp: null },
      levels: { a_gain_db: -4.25, b_gain_db: -1.5 },
    };
  }) as Request;
  const studio = { clipFor: vi.fn(async () => ({ status: 'none', reason: 'none', attempts: [], tookMs: 0, implementation: 'x' })), dispose: vi.fn() };
  const clipAudio = { duration: 6, length: 6 * RATE, sampleRate: RATE, numberOfChannels: 2, getChannelData: () => new Float32Array(6 * RATE) };
  const deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> } = {
    workspaceId: 'ws-1',
    cloud,
    songOf: async (songId) => ({ song: { songId, sha: sha(songId) }, data: async () => new ArrayBuffer(songId) }),
    inCloud: async (songIds) => new Set(songIds.filter((id) => id <= 2)),
    studio: () => studio as unknown as DeviceStudio,
    decode: async (bytes) => (bytes.byteLength === CLIP ? clipAudio : { n: bytes.byteLength }) as unknown as AudioBuffer,
    level: async () => 1,
    link: () => 'blob:mix',
    write: vi.fn(async (options) => {
      written.push(options);
      return { ok: true, file: { format: 'flac', bytes: new Uint8Array(8), sha256: 'a'.repeat(64), durationSeconds: 300, mimeType: 'audio/flac', extension: 'flac', limiter: 'l' } } as const;
    }) as unknown as typeof exportFile,
    mix: async () => MIX,
  };
  const family = exportFamily(deps);
  const start = () => family.answer('POST', '/exports/jobs', new URLSearchParams(), { method: 'POST' });
  const state = async () => ((await family.answer('GET', '/exports/jobs', new URLSearchParams())) as { jobs: { state: string }[] }).jobs[0]?.state;
  return { start, state, written, asked, studio };
}

beforeEach(() => {
  setFlags(ON);
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const text = String(url);
    return new Response(new ArrayBuffer(text.includes('clip') ? CLIP : text.includes('/a.') ? LOSSLESS.a : LOSSLESS.b));
  }));
});
afterEach(() => {
  forgetExports();
  setFlags(null);
  vi.unstubAllGlobals();
});

const song = (n: number) => ({ n }) as unknown as AudioBuffer;

describe('a file with a transition made in the cloud', () => {
  it('joins the cloud’s clip with its songs’ lossless files at the clip’s levels', async () => {
    const { start, state, written, asked, studio } = rig();
    await start();
    await vi.waitFor(async () => expect(await state()).toBe('ready'));
    const options = written[0];
    // the clip, counted at the export's decode rate, at the levels from the same dB
    const clip = await options.joins!(0, song(1), song(2), { a: gainOf(-4.25), b: gainOf(-1.5) });
    expect(clip).toMatchObject({ sampleRate: RATE, aStartSample: 100 * RATE, bEndSample: 4 * RATE, levels: { a: gainOf(-4.25), b: gainOf(-1.5) }, implementation: 'cloud-studio-1' });
    // the two songs next to it from their lossless files, at those levels; the others as before
    expect((await Promise.all(options.tracks.map((track) => track.data()))).map((bytes) => bytes.byteLength)).toEqual([LOSSLESS.a, LOSSLESS.b, 3, 4]);
    expect(await Promise.all([0, 1, 2, 3].map((index) => options.level!(index, song(index))))).toEqual([gainOf(-4.25), gainOf(-1.5), 1, 1]);
    // the device studio makes only the seam between two songs that are not next to a cloud clip
    expect(studio.clipFor).toHaveBeenCalledTimes(1);
    expect(await options.joins!(1, song(2), song(3), { a: 1, b: 1 })).toBeNull();
    // asked once, on the standard lane, by catalogue ids
    expect(asked.map((one) => `${one.method} ${one.path}`)).toEqual(['POST /hosted/seams']);
    expect(JSON.parse(asked[0].body)).toEqual({ a: 1, b: 2, move: null, lane: 'standard' });
  });

  it('asks nothing of the cloud with the flag off, and every song is read as before', async () => {
    setFlags({ ...ON, 'cloud.studio_seams': false });
    const { start, state, written, asked, studio } = rig();
    await start();
    await vi.waitFor(async () => expect(await state()).toBe('ready'));
    expect(asked).toEqual([]);
    expect((await Promise.all(written[0].tracks.map((track) => track.data()))).map((bytes) => bytes.byteLength)).toEqual([1, 2, 3, 4]);
    expect(studio.clipFor).toHaveBeenCalledTimes(3);
  });
});
