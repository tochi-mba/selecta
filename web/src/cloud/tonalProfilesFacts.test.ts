import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { MediaStore, StoredSong } from '../media';
import type { AnalysisRequest, AnalysisResponse } from '../dsp/workers/analysisWorker';
import type { TonalProfile } from '../dsp/analysis/tonalProfile';
import type { SongFacts } from '../dsp/analysis/song';
import { factsVersion, NEURAL_BEATS_IMPLEMENTATION } from '../dsp/analysis/deviceAnalysisIds';
import { readBeatCalibration, type BeatSourceChoice } from '../dsp/analysis/beatThis/gate';
import { startTonalProfiler, type ProfileRecord, type TonalStore } from './tonalProfiles';
import type { FactsRecord, FactsStore } from './songFacts';

// The background profiler with cloud.device_analysis: off, it measures key profiles exactly as
// before and never touches song facts; on, it decodes each song once at 44.1 kHz stereo for the
// facts (and the profile when it is still needed), and skips songs already measured.

const sha = 'd'.repeat(64);
const profile = { implementation: 'tonal-profile-v1', key: 'A', mode: 'minor' } as unknown as TonalProfile;
const measuredFacts = { implementation: 'web-dsp-1', row: null, arrays: null } as unknown as SongFacts;

function tonalStore(known: ProfileRecord[] = []): TonalStore & { puts: ProfileRecord[] } {
  const records = new Map(known.map((record) => [record.sha, record]));
  const puts: ProfileRecord[] = [];
  return {
    puts,
    records: async () => records,
    put: async (record) => { puts.push(record); records.set(record.sha, record); },
    reviews: async () => new Map(),
    review: async () => undefined,
  };
}

function factsStore(present = false): FactsStore & { has: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; puts: FactsRecord[] } {
  const puts: FactsRecord[] = [];
  let measured = present;
  const store = {
    puts,
    has: vi.fn(async () => measured),
    put: vi.fn(async (record: FactsRecord) => { puts.push(record); measured = true; }),
  };
  return store;
}

function fakeWorker(extra: Partial<AnalysisResponse> = {}) {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const requests: AnalysisRequest[] = [];
  const worker = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.get(type)?.delete(listener),
    postMessage: (request: AnalysisRequest) => {
      requests.push(request);
      const tasks = request.tasks ?? [];
      const answer: AnalysisResponse = {
        id: request.id,
        ...(tasks.includes('profile') ? { profile } : {}),
        ...(tasks.includes('song') ? { facts: measuredFacts } : {}),
        ...extra,
      };
      setTimeout(() => listeners.get('message')?.forEach((listener) => listener({ data: answer })), 0);
    },
    terminate: () => undefined,
  };
  return { worker: worker as unknown as Worker, requests };
}

const decodedAt: number[] = [];

class FakeOfflineAudioContext {
  constructor(_channels: number, _length: number, readonly sampleRate: number) {
    decodedAt.push(sampleRate);
  }
  decodeAudioData() {
    const length = this.sampleRate * 2;
    return Promise.resolve({
      numberOfChannels: 2,
      length,
      sampleRate: this.sampleRate,
      getChannelData: (channel: number) => new Float32Array(length).fill(0.1 * (channel + 1)),
    });
  }
}

const song = { songId: 7, identity: { content_sha256: sha } } as unknown as StoredSong;
const media = { all: async () => [song] } as unknown as MediaStore;

async function until(done: () => boolean, withinMs = 10_000) {
  const started = Date.now();
  while (!done() && Date.now() - started < withinMs) await new Promise((resolve) => setTimeout(resolve, 20));
}

function run(store: TonalStore, facts: FactsStore, worker: Worker, chooseBeats?: () => Promise<BeatSourceChoice>) {
  return startTonalProfiler({
    store,
    facts,
    chooseBeats,
    openMedia: async () => media,
    resolve: async () => ({ id: 7, data: async () => new ArrayBuffer(16) }),
    playing: () => false,
    workerFactory: () => worker,
  });
}

beforeEach(() => {
  decodedAt.length = 0;
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
});

afterEach(() => {
  setFlags(null);
  vi.unstubAllGlobals();
});

describe('the profiler with cloud.device_analysis off', () => {
  it('measures the key profile as before and never touches song facts', async () => {
    setFlags({ 'cloud.device_analysis': false });
    const store = tonalStore();
    const facts = factsStore();
    const { worker, requests } = fakeWorker();
    const stop = run(store, facts, worker);
    await until(() => store.puts.length > 0);
    stop();
    expect(requests).toHaveLength(1);
    expect(requests[0].tasks).toEqual(['profile']);
    expect(requests[0].sampleRate).toBe(22050);
    expect(requests[0].channels).toBeUndefined();
    expect(decodedAt).toEqual([22050]);
    expect(store.puts).toEqual([{ sha, implementation: 'tonal-profile-v1', profile }]);
    expect(facts.has).not.toHaveBeenCalled();
    expect(facts.put).not.toHaveBeenCalled();
  }, 20_000);
});

describe('the profiler with cloud.device_analysis on', () => {
  beforeEach(() => setFlags({ 'cloud.device_analysis': true }));

  it('decodes once at the Desktop rate in stereo for the facts and the profile', async () => {
    const store = tonalStore();
    const facts = factsStore();
    const { worker, requests } = fakeWorker();
    const stop = run(store, facts, worker);
    await until(() => facts.puts.length > 0);
    stop();
    expect(decodedAt).toEqual([44100]);
    expect(requests).toHaveLength(1);
    expect(requests[0].tasks).toEqual(['song', 'profile']);
    expect(requests[0].sampleRate).toBe(44100);
    expect(requests[0].pcm.length).toBe(0);
    expect(requests[0].channels).toHaveLength(2);
    expect(facts.puts).toEqual([{ sha, version: factsVersion(), facts: measuredFacts }]);
    expect(store.puts).toEqual([{ sha, implementation: 'tonal-profile-v1', profile }]);
  }, 20_000);

  it('measures only the facts when the profile is already known', async () => {
    const store = tonalStore([{ sha, implementation: 'tonal-profile-v1', profile }]);
    const facts = factsStore();
    const { worker, requests } = fakeWorker();
    const stop = run(store, facts, worker);
    await until(() => facts.puts.length > 0);
    stop();
    expect(requests).toHaveLength(1);
    expect(requests[0].tasks).toEqual(['song']);
    expect(store.puts).toEqual([]);
  }, 20_000);

  it('skips a song already measured at the current version', async () => {
    const store = tonalStore([{ sha, implementation: 'tonal-profile-v1', profile }]);
    const facts = factsStore(true);
    const { worker, requests } = fakeWorker();
    const stop = run(store, facts, worker);
    await until(() => facts.has.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    stop();
    expect(requests).toEqual([]);
    expect(decodedAt).toEqual([]);
    expect(facts.put).not.toHaveBeenCalled();
  }, 20_000);
});

describe('the profiler with the neural beat tracker chosen', () => {
  const neuralVersion = factsVersion(NEURAL_BEATS_IMPLEMENTATION);
  const neural: BeatSourceChoice = { kind: 'neural', implementation: NEURAL_BEATS_IMPLEMENTATION, sha256: 'e'.repeat(64), calibrated: false };
  const neuralFacts = { implementation: 'web-dsp-1', beat_source: NEURAL_BEATS_IMPLEMENTATION, row: null, arrays: null } as unknown as SongFacts;
  beforeEach(() => {
    setFlags({ 'cloud.device_analysis': true });
    localStorage.clear();
  });

  /** Measured with the interim source already: has() answers only for that version. */
  function interimOnly(): FactsStore & { puts: FactsRecord[]; asked: string[] } {
    const puts: FactsRecord[] = [];
    const asked: string[] = [];
    return {
      puts, asked,
      has: async (_sha: string, version?: string) => { asked.push(version ?? factsVersion()); return version !== neuralVersion || puts.length > 0; },
      put: async (record: FactsRecord) => { puts.push(record); },
    };
  }

  it('measures an interim song again with the tracker, keeps it under the tracker, and times the device', async () => {
    const store = tonalStore([{ sha, implementation: 'tonal-profile-v1', profile }]);
    const facts = interimOnly();
    const { worker, requests } = fakeWorker({ facts: neuralFacts, beatMs: 9_000 });
    const stop = run(store, facts, worker, async () => neural);
    await until(() => facts.puts.length > 0);
    stop();
    expect(facts.asked[0]).toBe(neuralVersion);
    expect(requests).toHaveLength(1);
    expect(requests[0].beatModel).toEqual({ sha256: 'e'.repeat(64) });
    expect(facts.puts).toEqual([{ sha, version: neuralVersion, facts: neuralFacts }]);
    // the fake song is two seconds long: 4,500 ms of tracking per second of audio, too slow
    expect(readBeatCalibration()?.msPerAudioSecond).toBe(4_500);
  }, 20_000);

  it('keeps a fallback under the source that really measured, so the song waits for the tracker', async () => {
    const store = tonalStore([{ sha, implementation: 'tonal-profile-v1', profile }]);
    const facts = interimOnly();
    const interimFacts = { implementation: 'web-dsp-1', beat_source: 'web-onset-comb-beats-1', row: null, arrays: null } as unknown as SongFacts;
    const { worker } = fakeWorker({ facts: interimFacts, beatFallback: 'the beat model is not in this browser\'s storage' });
    const stop = run(store, facts, worker, async () => neural);
    await until(() => facts.puts.length > 0);
    stop();
    expect(facts.puts).toEqual([{ sha, version: factsVersion(), facts: interimFacts }]);
    expect(readBeatCalibration()).toBeNull();
  }, 20_000);
});
