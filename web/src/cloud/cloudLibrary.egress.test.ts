import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { exportFile } from '../engine/export';
import { setFlags } from '../flags';
import { assertNoPath } from '../media/identity';
import type { MediaResolver } from '../media';
import { exportFamily, forgetExports, type ExportDeps } from './localExport';

// The cloud library's requests from the browser: every request this code makes is one of the
// routes listed here, and no body carries audio, a file or folder name, or a path. Extend ALLOWED
// with each new request a cloud library feature makes, and a case that makes it.
//
// cloud.one_mixer (Phase 4): saving a mix with cloud songs as a file here asks the account for
// nothing (the songs are read through the player's resolver, which this file stands in for); "Make
// the file in your cloud library" asks for the export by catalogue song id, then its state.

/** Every request the cloud library code here may make of the account, and nothing else. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  // cloud.one_mixer: the export by catalogue song ids, and the job it made by its id
  ['POST', /^\/hosted\/mixes\/export$/],
  ['GET', /^\/hosted\/exports\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/],
];

const FLAGS = { 'cloud.local_export': true, 'cloud.one_mixer': true, 'cloud.hosted_render': true, 'cloud.device_render': false };
const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: null });
const MIX: MixData = { mix: [item(1, 0), item(2, 1), item(3, 2)], name: 'C:\\Users\\rex\\Music\\Friday', can_undo: false };

type Sent = { method: string; path: string; body: string };

function watched() {
  const sent: Sent[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    sent.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body: typeof init?.body === 'string' ? init.body : '' });
    return path.startsWith('/hosted/mixes/export') ? { state: 'queued', job_id: 'job-1' } : { state: 'ready', url: 'https://r2.test/mix.flac' };
  }) as Request;
  return { sent, cloud };
}

function heldTo(sent: readonly Sent[]) {
  for (const one of sent) {
    expect(ALLOWED.some(([method, path]) => method === one.method && path.test(one.path)), `${one.method} ${one.path}`).toBe(true);
    // catalogue ids and an export id only: nothing audio-sized, no file name, no path
    expect(one.body.length).toBeLessThan(4096);
    expect(one.body).not.toMatch(/\.(mp3|flac|wav|m4a|aiff?)\b|Users|Music/i);
    if (!one.body) continue;
    assertNoPath(JSON.parse(one.body));
    expect(Object.keys(JSON.parse(one.body))).toEqual(['songs']);
  }
}

beforeEach(() => setFlags(FLAGS));
afterEach(() => {
  forgetExports();
  setFlags(null);
});

describe('the cloud library’s requests (cloud.one_mixer)', () => {
  it('saving a mix with cloud songs as a file here asks the account for nothing', async () => {
    const { sent, cloud } = watched();
    const resolver: MediaResolver = async (songId) => ({ id: songId, source: 'hosted', data: async () => new ArrayBuffer(16) });
    const deps: ExportDeps & { mix: (draft: number | null) => Promise<MixData> } = {
      workspaceId: 'ws-1', cloud, mix: async () => MIX,
      songOf: async (songId) => (songId === 1 ? { song: { songId, sha: 'a'.repeat(64) }, data: async () => new ArrayBuffer(16) } : null),
      resolve: async () => resolver,
      inCloud: async () => new Set([2, 3]),
      decode: async () => ({}) as AudioBuffer, level: async () => 1, link: () => 'blob:mix',
      write: (async (options: Parameters<typeof exportFile>[0]) => {
        for (const track of options.tracks) await track.data();
        return { ok: true, file: { format: 'flac', bytes: new Uint8Array(8), sha256: 'a'.repeat(64), durationSeconds: 1, mimeType: 'audio/flac', extension: 'flac', limiter: 'l' } } as const;
      }) as unknown as typeof exportFile,
    };
    const family = exportFamily(deps);
    await family.answer('POST', '/exports/jobs', new URLSearchParams(), { method: 'POST' });
    await vi.waitFor(async () => expect(((await family.answer('GET', '/exports/jobs', new URLSearchParams())) as { jobs: { state: string }[] }).jobs[0].state).toBe('ready'));
    expect(sent).toEqual([]);
  });

  it('making the file in the cloud library sends catalogue song ids, then follows the job by id', async () => {
    const { sent, cloud } = watched();
    const family = exportFamily({ workspaceId: 'ws-1', cloud, mix: async () => MIX, inCloud: async () => new Set([1, 2, 3]) });
    await family.answer('GET', '/exports/cloud', new URLSearchParams());
    await family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST', headers: { 'x-mix-order': '1,2,3' } });
    await family.answer('GET', '/exports/cloud/job-1', new URLSearchParams());
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual(['POST /hosted/mixes/export', 'GET /hosted/exports/job-1']);
    expect(JSON.parse(sent[0].body)).toEqual({ songs: [{ song_id: 1 }, { song_id: 2 }, { song_id: 3 }] });
    heldTo(sent);
  });

  it('asks for nothing when a song is outside the cloud library, or with the flag off', async () => {
    const { sent, cloud } = watched();
    const family = exportFamily({ workspaceId: 'ws-1', cloud, mix: async () => MIX, inCloud: async () => new Set([1, 3]) });
    await expect(family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST' })).rejects.toMatchObject({ code: 'not_in_cloud' });
    setFlags({ ...FLAGS, 'cloud.one_mixer': false });
    await expect(family.answer('POST', '/exports/cloud', new URLSearchParams(), { method: 'POST' })).rejects.toMatchObject({ code: 'flag_off' });
    expect(sent).toEqual([]);
  });
});
