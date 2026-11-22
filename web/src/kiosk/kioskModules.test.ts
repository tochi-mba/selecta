// vitest for the kiosk's pure modules (ADR-0445 BZ-0445-04, 06, 07, 08, 09; ADR-0446 kiosk side).
import { describe, expect, it, vi } from 'vitest';
import { createZoneCache, memoryBlobStore } from '../business/offline/zoneCache';
import { kioskApi, KioskCallError } from './api';
import { detectAutoplay } from './audio';
import { base64url, deviceKey, memoryKeyStore, SIGNED_PREFIX } from './deviceKey';
import { downloadSegment, fillCache } from './download';
import { isDigitalSilence, outputMeter, rmsDbfs } from './meter';
import { equalPower, fallbackNext, segmentAt, type PlayableSegment } from './player';
import { playLog } from './playLog';
import { dayStateAt, markSession, restartReason, startupAction } from './startup';
import { updateDecision } from './update';
import { wakeController } from './wake';

const seg = (id: string, starts: number, duration = 100, extra: Partial<PlayableSegment> = {}): PlayableSegment =>
  ({ id, key: `w/k/a/${id}`, starts_at: starts, duration_s: duration, bytes: 10, sha256: '', committed: false, kind: 'song', ...extra });

describe('output level meter (BZ-0445-09)', () => {
  it('measures RMS in dBFS and calls digital silence below -60', () => {
    expect(rmsDbfs(new Float32Array(64).fill(1))).toBe(0);
    expect(rmsDbfs(new Float32Array(64).fill(0.5))).toBeCloseTo(-6, 0);
    expect(rmsDbfs(new Float32Array(64))).toBe(-120);
    expect(isDigitalSilence(rmsDbfs(new Float32Array(64).fill(0.0001)))).toBe(true);
    expect(isDigitalSilence(-20)).toBe(false);
  });

  it('reads the analyser after the gain, and nothing without Web Audio', () => {
    const analyser = { fftSize: 8, getFloatTimeDomainData: (t: Float32Array) => t.fill(0.1) };
    expect(outputMeter(analyser).level()).toBeCloseTo(-20, 0);
    expect(outputMeter(null).level()).toBeNull();
  });
});

describe('autoplay detection (BZ-0445-04)', () => {
  const context = (state: string, after: string) => ({
    state,
    destination: {},
    createBuffer: () => ({}),
    createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
    resume() { this.state = after; return Promise.resolve(); },
  });
  it('is detected without sound: a context that stays suspended means blocked', async () => {
    expect(await detectAutoplay(context('suspended', 'suspended'), 10)).toBe(false);
    expect(await detectAutoplay(context('suspended', 'running'), 10)).toBe(true);
    expect(await detectAutoplay(null)).toBe(false);
  });
});

describe('startup after a restart (BZ-0445-06)', () => {
  const periods = [{ opens_at: 1000, closes_at: 5000 }];
  it('works out the day from the saved schedule', () => {
    expect(dayStateAt(periods, 2000).state).toBe('open');
    expect(dayStateAt(periods, 1000 - 60).state).toBe('warming');
    expect(dayStateAt(periods, 6000).state).toBe('closed');
  });
  it('resumes with a fade when open, shows Closed when closed, never starts on untrusted time', () => {
    expect(startupAction({ paired: true, clock: 'trusted', day: 'open', autoplayAllowed: true })).toEqual({ kind: 'resume', fadeInS: 5 });
    expect(startupAction({ paired: true, clock: 'wall_plausible', day: 'closed', autoplayAllowed: true })).toEqual({ kind: 'closed' });
    expect(startupAction({ paired: true, clock: 'untrusted', day: 'open', autoplayAllowed: true })).toEqual({ kind: 'tap', reason: 'time_unknown' });
    expect(startupAction({ paired: true, clock: 'trusted', day: 'open', autoplayAllowed: false })).toEqual({ kind: 'tap', reason: 'autoplay' });
    expect(startupAction({ paired: false, clock: 'trusted', day: 'open', autoplayAllowed: true })).toEqual({ kind: 'pair' });
  });
  it('tells a crash from a clean restart', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    expect(restartReason(store)).toBe('first_start');
    markSession('running', store);
    expect(restartReason(store)).toBe('crash');
    markSession('closed', store);
    expect(restartReason(store)).toBe('power_or_crash');
    markSession('update', store);
    expect(restartReason(store)).toBe('update');
  });
});

describe('wake lock (BZ-0445-07)', () => {
  it('is held while playing and released when not', () => {
    const release = vi.fn();
    const hold = vi.fn(() => ({ release, held: () => true }));
    const nav = { wakeLock: {} } as unknown as Navigator;
    const wake = wakeController(nav, document, hold);
    wake.sync(true);
    wake.sync(true);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(wake.held()).toBe(true);
    wake.sync(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(wake.held()).toBe(false);
    expect(wakeController({} as Navigator, document, hold).supported()).toBe(false);
  });
});

describe('update windows (BZ-0445-08)', () => {
  const base = { running: '1', latest: { version: '2', urgent: false }, atFadeBoundary: false, ready: true };
  it('activates only while closed', () => {
    expect(updateDecision({ ...base, day: 'open' }).activate).toBe(false);
    expect(updateDecision({ ...base, day: 'warming' }).activate).toBe(false);
    expect(updateDecision({ ...base, day: 'closed' }).activate).toBe(true);
    expect(updateDecision({ ...base, day: 'closed', ready: false }).activate).toBe(false);
  });
  it('lets an urgent fix in during service only at a fade boundary', () => {
    const urgent = { ...base, latest: { version: '2', urgent: true }, day: 'open' as const };
    expect(updateDecision(urgent).activate).toBe(false);
    expect(updateDecision({ ...urgent, atFadeBoundary: true })).toEqual({ activate: true, urgent: true });
  });
});

describe('device key (BZ-0445-03)', () => {
  it('signs the prefixed nonce with a non-extractable key that verifies with the sent public key', async () => {
    const store = memoryKeyStore();
    const key = await deviceKey(store);
    expect((await store.get())?.keys.privateKey.extractable).toBe(false);
    const signature = await key.sign('nonce-1');
    const decode = (t: string) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const raw = decode(signature);
    expect(raw.length).toBe(64);
    const spki = decode(key.publicKey);
    const pub = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, raw, new TextEncoder().encode(`${SIGNED_PREFIX}nonce-1`));
    expect(ok).toBe(true);
    expect((await deviceKey(store)).publicKey).toBe(key.publicKey); // kept
    expect(base64url(new Uint8Array([255, 254]))).toBe('__4');
  });
});

describe('kiosk api', () => {
  it('a stale nonce after a restart is refreshed and the heartbeat retried once', async () => {
    const sent: string[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body.nonce);
      if (body.nonce === 'restart') return new Response(JSON.stringify({ detail: { code: 'kiosk_nonce_stale', nonce: 'n-2' } }), { status: 409 });
      return new Response(JSON.stringify({ outcome: 'renewed', nonce: 'n-3', server_time: 10, session: null, latest: { version: '9', urgent: false } }), { status: 200 });
    });
    const api = kioskApi({ fetch: fetch as unknown as typeof globalThis.fetch, origin: '', sign: async (n) => `sig-${n}`, version: '1' });
    const answer = await api.heartbeat({ song_index: 0, offset_ms: 0, state: 'playing' });
    expect(sent).toEqual(['restart', 'n-2']);
    expect(answer.outcome).toBe('renewed');
    expect(api.nonce()).toBe('n-3');
  });

  it('a revoked token surfaces as a 401 with its code', async () => {
    const fetch = async () => new Response(JSON.stringify({ detail: { code: 'kiosk_revoked' } }), { status: 401 });
    const api = kioskApi({ fetch: fetch as unknown as typeof globalThis.fetch, origin: '', sign: async () => 's' });
    await expect(api.heartbeat({ song_index: 0, offset_ms: 0, state: 'stopped' })).rejects.toMatchObject({ status: 401, code: 'kiosk_revoked' });
    expect(new KioskCallError(0).status).toBe(0);
  });
});

describe('player scheduling and the fallback reel (ADR-0446 BZ-0446-07, kiosk side)', () => {
  const plan = [seg('a', 0), seg('b', 100), seg('c', 200)];
  it('plays the saved segment the schedule covers, at the right offset', () => {
    expect(segmentAt(plan, 150, () => true)).toEqual({ segment: plan[1], offsetS: 50 });
    expect(segmentAt(plan, 150, (s) => s.id !== 'b')).toBeNull();
    expect(segmentAt(plan, 400, () => true)).toBeNull();
  });
  it('past the horizon replays saved songs, never one heard within the hour while others are left', () => {
    const played = new Map([['a', 1000], ['b', 3000]]);
    expect(fallbackNext(plan, played, 4000)?.id).toBe('c');
    expect(fallbackNext([plan[0], plan[1]], played, 4000)?.id).toBe('a'); // all recent: the longest ago
    expect(fallbackNext([seg('t', 0, 10, { kind: 'transition' })], new Map(), 0)).toBeNull();
  });
  it('crossfades with equal power', () => {
    const { fadeIn, fadeOut } = equalPower(5);
    for (let i = 0; i < 5; i += 1) expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 5);
  });
});

describe('downloads with signed URLs (ADR-0446 BZ-0446-04, kiosk side)', () => {
  it('a 403 refreshes the URL once and resumes with Range from the saved bytes', async () => {
    const urls = ['u1', 'u2'];
    const calls: { url: string; range?: string }[] = [];
    let first = true;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>)?.Range;
      calls.push({ url, range });
      if (url === 'u1' && first) {
        first = false;
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls === 1) controller.enqueue(new Uint8Array([1, 2, 3]));
            else controller.error(new Error('expired')); // the URL ran out mid-way
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(new Uint8Array([4, 5]), { status: 206 });
    });
    const blob = await downloadSegment(seg('a', 0), { urlFor: async () => urls.shift() ?? 'u3', fetch: fetch as unknown as typeof globalThis.fetch });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(calls).toEqual([{ url: 'u1', range: undefined }, { url: 'u2', range: 'bytes=3-' }]);
  });

  it('saves the missing horizon nearest first and never fetches while offline', async () => {
    const cache = createZoneCache({ store: memoryBlobStore(), now: () => 0, hash: async () => null });
    await cache.setManifest({ zone_id: 'z', version: 'v', segments: [seg('b', 100), seg('a', 0)] });
    const fetched: string[] = [];
    const fetch = async (url: string) => { fetched.push(url); return new Response(new Uint8Array([1])); };
    expect(await fillCache(cache, { urlFor: async (k) => k, fetch: fetch as unknown as typeof globalThis.fetch, online: () => false })).toBe(0);
    expect(fetched).toEqual([]);
    expect(await fillCache(cache, { urlFor: async (k) => k, fetch: fetch as unknown as typeof globalThis.fetch, online: () => true })).toBe(2);
    expect(fetched[0]).toBe('w/k/a/a');
    expect(cache.coverageSeconds(0)).toBe(200);
  });
});

describe('the local play log (ADR-0446 resync, kiosk side)', () => {
  it('numbers entries and drops only what the server acknowledged', () => {
    const data = new Map<string, string>();
    const log = playLog({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
    const a = log.add({ kind: 'play', idempotency_key: 'a', started_at: 1, recorded_at: 2 });
    const b = log.add({ kind: 'play', idempotency_key: 'b', started_at: 3, recorded_at: 4 });
    expect([a.device_seq, b.device_seq]).toEqual([1, 2]);
    log.acknowledge(['a']);
    expect(log.pending().map((e) => e.idempotency_key)).toEqual(['b']);
  });
});

describe('a song cut by a rendered seam (ADR-0446 BZ-0446-01, kiosk side)', () => {
  it('starts the file at its seam cue plus the offset the schedule says', async () => {
    const { createPlayer } = await import('./player');
    const elements: { currentTime: number; play: () => Promise<void>; pause: () => void; volume: number; src: string; preload: string; paused: boolean; ended: boolean; duration: number }[] = [];
    const createAudio = () => {
      const el = { currentTime: 0, play: async () => { el.paused = false; }, pause: () => { el.paused = true; }, volume: 1, src: '', preload: '', paused: true, ended: false, duration: 200 };
      elements.push(el);
      return el as unknown as HTMLAudioElement;
    };
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    const player = createPlayer({ now: () => 1_030, saved: () => true, blob: async () => new Blob(['x']), createAudio, context: null });
    player.setSegments([seg('b', 1_000, 100, { from_s: 12 })]);
    player.start(0); // starts its first tick itself
    await new Promise((resolve) => setTimeout(resolve, 0));
    const playing = elements.find((el) => !el.paused);
    expect(playing?.currentTime).toBe(42);
    expect(player.position().offsetS).toBe(30);
  });
});
