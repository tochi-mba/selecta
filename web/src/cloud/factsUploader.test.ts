import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { factsVersion } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { setAccountFeatures, setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { CloudError } from './api';
import { FACTS_ARRAYS, FACTS_FIELDS } from './factsWire';
import { BACKOFF_BASE_MS, BETWEEN_SONGS_MS, RESWEEP_MS, startFactsUploader, type SentMemory } from './factsUploader';
import { heldSong, measuredSong, PRIVATE_WORDS, shaOf } from './testAccountFacts';

// docs/engineering/device-to-account.md: the uploader sends exactly the schema's fields, skips
// what the account has, treats 409 outranked as done, never sends twice, backs off, and does
// nothing unless the server names both flags on.

type Call = { method: string; path: string; body?: unknown };

function fakeAccount(options: { has?: Record<number, { implementation: string; source: string }>; put?: (songId: number) => unknown } = {}) {
  const calls: Call[] = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET' && path.startsWith('/song-facts?')) {
      return { songs: Object.entries(options.has ?? {}).map(([id, measured]) => ({ song_id: Number(id), ...measured, measured_at: 't' })) } as T;
    }
    const put = /^\/song-facts\/(\d+)$/.exec(path);
    if (put && method === 'PUT') {
      const answer = options.put?.(Number(put[1]));
      if (answer instanceof Error) throw answer;
      return (answer ?? { song_id: Number(put[1]), implementation: 'web-dsp-1', source: 'device', measured_at: 't', replaced: false }) as T;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { request, calls, puts: () => calls.filter((call) => call.method === 'PUT') };
}

/** Waits the test controls: the short gap between songs passes at once; a pass's long wait
 * (the next sweep, a backoff) holds until `next()`. */
function controlledWaits() {
  const long: Array<() => void> = [];
  const asked: number[] = [];
  return {
    asked,
    wait: (ms: number) => {
      asked.push(ms);
      if (ms <= BETWEEN_SONGS_MS) return Promise.resolve();
      return new Promise<void>((resolve) => long.push(resolve));
    },
    next: () => long.shift()?.(),
    holding: () => long.length,
  };
}

function memoryOf(start: Record<string, string> = {}): SentMemory & { kept: Record<string, string> } {
  const memory = {
    kept: { ...start },
    read: async () => ({ ...memory.kept }),
    write: async (sent: Record<string, string>) => { memory.kept = { ...sent }; },
  };
  return memory;
}

const factsBySha = (entries: Array<[string, SongFacts]>) => {
  const map = new Map(entries);
  return async (sha: string) => map.get(sha) ?? null;
};

let stop: (() => void) | null = null;
beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
});
afterEach(() => {
  stop?.();
  stop = null;
  setFlags(null);
  setAccountFeatures(null);
});

function start(account: ReturnType<typeof fakeAccount>, songs: ReturnType<typeof heldSong>[], facts: Array<[string, SongFacts]>, memory = memoryOf()) {
  const waits = controlledWaits();
  stop = startFactsUploader({
    request: account.request, workspaceId: 'ws-1', openMedia: async () => ({ all: async () => songs }),
    facts: factsBySha(facts), memory, wait: waits.wait, idle: async () => undefined,
  });
  return { waits, memory };
}

describe('sending song measurements to the account', () => {
  it('sends exactly the schema fields, the seven arrays, and nothing from the song index', async () => {
    const account = fakeAccount();
    const { waits } = start(account, [heldSong(1, shaOf(1))], [[shaOf(1), measuredSong()]]);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    const [put] = account.puts();
    expect(put.path).toBe('/song-facts/1');
    const body = put.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...FACTS_FIELDS].sort());
    expect(Object.keys(body.arrays as object).sort()).toEqual([...FACTS_ARRAYS].sort());
    // the analysis port and the beat source together, so the account can rank them
    expect(body).toMatchObject({ content_sha256: shaOf(1), implementation: 'web-dsp-1+web-onset-comb-beats-1', bpm: 120, constant_tempo: true, key_agrees_chroma: true, beats_per_bar: 4 });
    const arrays = body.arrays as Record<string, { dtype: string; shape: number[]; data: string }>;
    expect(arrays.beats).toMatchObject({ dtype: '<f8', shape: [256] });
    expect(arrays.bar_starts).toMatchObject({ dtype: '<i4', shape: [64] });
    expect(arrays.chroma_bars).toMatchObject({ dtype: '<f4', shape: [64, 12] });
    expect(arrays.mfcc_bars).toMatchObject({ dtype: '<f4', shape: [64, 20] });
    // little-endian float64: the first beat decodes back to 0.25
    const bytes = Uint8Array.from(atob(arrays.beats.data), (char) => char.charCodeAt(0));
    expect(new DataView(bytes.buffer).getFloat64(0, true)).toBe(0.25);
    const text = JSON.stringify(body);
    for (const word of PRIVATE_WORDS) expect(text).not.toContain(word);
  });

  it('skips songs the account holds from a better or the same measurement, and sends over a lower one', async () => {
    const account = fakeAccount({ has: {
      1: { implementation: 'python-beatthis-3', source: 'worker' },
      2: { implementation: 'web-dsp-1+web-onset-comb-beats-1', source: 'device' },
      3: { implementation: 'web-old-0', source: 'device' },
      // an older client's measurement, before the beat source was named: ranks below this one
      5: { implementation: 'web-dsp-1', source: 'device' },
      // another device measured with Beat This: ranks above this device's interim beats
      6: { implementation: 'web-dsp-1+web-beatthis-small0-1', source: 'device' },
    } });
    const songs = [1, 2, 3, 4, 5, 6].map((id) => heldSong(id, shaOf(id)));
    const { waits, memory } = start(account, songs, songs.map((song) => [song.identity.content_sha256, measuredSong()]));
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(account.puts().map((call) => call.path)).toEqual(['/song-facts/3', '/song-facts/4', '/song-facts/5']);
    // the skipped ones are remembered as done too, so the next pass reads nothing for them
    expect(Object.keys(memory.kept).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('treats 409 outranked as done and never sends a song twice', async () => {
    const account = fakeAccount({ put: () => new CloudError('outranked', 409, 'outranked') });
    const { waits, memory } = start(account, [heldSong(7, shaOf(7))], [[shaOf(7), measuredSong()]]);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(account.puts()).toHaveLength(1);
    expect(memory.kept['7']).toBe(`${factsVersion()}:${shaOf(7)}`);
    expect(waits.asked).toContain(RESWEEP_MS);
    waits.next();
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(account.puts()).toHaveLength(1);
  });

  it('sends again once this device measured the song at a newer version', async () => {
    const account = fakeAccount({ has: { 5: { implementation: 'web-dsp-1', source: 'device' } } });
    const memory = memoryOf({ 5: `web-dsp-1+an-older-beat-source:${shaOf(5)}` });
    const { waits } = start(account, [heldSong(5, shaOf(5))], [[shaOf(5), measuredSong()]], memory);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(account.puts().map((call) => call.path)).toEqual(['/song-facts/5']);
  });

  it('sends a song again once Beat This measured it, over this device\'s own interim measurement', async () => {
    const account = fakeAccount({ has: { 8: { implementation: 'web-dsp-1+web-onset-comb-beats-1', source: 'device' } } });
    const memory = memoryOf({ 8: `${factsVersion()}:${shaOf(8)}` });
    const { waits } = start(account, [heldSong(8, shaOf(8))], [[shaOf(8), measuredSong({ beatSource: 'web-beatthis-small0-1' })]], memory);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    const puts = account.puts();
    expect(puts.map((call) => call.path)).toEqual(['/song-facts/8']);
    expect((puts[0].body as { implementation: string }).implementation).toBe('web-dsp-1+web-beatthis-small0-1');
    expect(memory.kept['8']).toBe(`web-dsp-1+web-beatthis-small0-1:${shaOf(8)}`);
  });

  it('backs off after an error that can heal, without marking the song sent', async () => {
    let failing = true;
    const account = fakeAccount({ put: () => (failing ? new CloudError('busy', 503, 'server') : undefined) });
    const { waits, memory } = start(account, [heldSong(2, shaOf(2))], [[shaOf(2), measuredSong()]]);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    const backoff = waits.asked[waits.asked.length - 1];
    expect(backoff).toBeGreaterThanOrEqual(BACKOFF_BASE_MS / 2);
    expect(backoff).toBeLessThan(RESWEEP_MS);
    expect(memory.kept).toEqual({});
    failing = false;
    waits.next();
    await vi.waitFor(() => expect(memory.kept['2']).toBeDefined());
    expect(account.puts()).toHaveLength(2);
  });

  it('reads no measurement for a hash the index has not proven from the bytes', async () => {
    const account = fakeAccount();
    const read = vi.fn(async () => measuredSong());
    const waits = controlledWaits();
    stop = startFactsUploader({
      request: account.request, workspaceId: 'ws-1', openMedia: async () => ({ all: async () => [heldSong(3, shaOf(3), { fingerprint: 'remembered' })] }),
      facts: read, memory: memoryOf(), wait: waits.wait, idle: async () => undefined,
    });
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(read).not.toHaveBeenCalled();
    expect(account.puts()).toEqual([]);
  });

  it.each([
    ['cloud.brain off', { 'cloud.brain': false, 'cloud.device_analysis': true }],
    ['cloud.device_analysis off', { 'cloud.brain': true, 'cloud.device_analysis': false }],
    ['a server that names neither flag', {}],
    ['a server that names only one', { 'cloud.brain': true }],
  ])('asks and sends nothing with %s', async (_name, flags) => {
    setFlags(flags);
    const account = fakeAccount();
    const { waits } = start(account, [heldSong(1, shaOf(1))], [[shaOf(1), measuredSong()]]);
    await vi.waitFor(() => expect(waits.holding()).toBe(1));
    expect(account.calls).toEqual([]);
  });
});
