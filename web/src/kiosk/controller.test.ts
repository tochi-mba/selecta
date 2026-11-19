// The kiosk's wiring with fakes and a fake clock (ADR-0445 BZ-0445-02, 04, 06, 11; ADR-0446).
import { describe, expect, it, vi } from 'vitest';
import { OfflineClock } from '../business/offline/offlineClock';
import { createZoneCache, memoryBlobStore } from '../business/offline/zoneCache';
import { KioskCallError, type KioskApi } from './api';
import type { ZoneAudio } from './audio';
import { createController, type ControllerDeps } from './controller';
import type { PlayableSegment } from './player';
import { playLog } from './playLog';
import { renderScreen } from './screens';
import { mountStaffPanel } from './staffPanel';
import { startBurnIn } from './burnIn';
import type { KioskScreen } from './state';
import { sanitiseKioskView } from './view';
import { permitStore, type SignedBundle } from './permit';
import vectors from './permitVectors.json';

const OPEN = { opens_at: 1_000, closes_at: 50_000 };

function setup(over: { paired?: boolean; autoplay?: boolean; online?: boolean; wall?: number; bundle?: SignedBundle; trusted?: string[] } = {}) {
  let wall = over.wall ?? 10_000;
  let mono = 0;
  const clock = new OfflineClock({ monotonic: () => mono, wall: () => wall });
  const cache = createZoneCache({ store: memoryBlobStore(), now: () => wall, hash: async () => null });
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  if (over.paired) storage.setItem('selectadj-kiosk-paired', '1');
  let online = over.online ?? true;
  const offline = () => new KioskCallError(0);
  const player = {
    started: false, stopped: 0, segments: [] as PlayableSegment[],
    start: vi.fn(function (this: void) { player.started = true; }),
    stop: vi.fn(() => { player.started = false; player.stopped += 1; }),
    setSegments: vi.fn((s: PlayableSegment[]) => { player.segments = s; }),
    setPaused: vi.fn(), setVolume: vi.fn(), tick: vi.fn(async () => undefined),
    mode: () => 'horizon' as const, playing: () => player.started, fadingOut: () => false,
    position: () => ({ segment: null, offsetS: 0 }), level: () => -20, contextState: () => 'running', current: () => null,
  };
  const audio = {
    player, context: null, unlocked: () => over.autoplay ?? true,
    unlock: vi.fn(async () => over.autoplay ?? true), playing: () => player.started, savedHoursAhead: () => 2,
  } as unknown as ZoneAudio;
  const api = {
    setNonce: vi.fn(), nonce: () => 'n',
    startPairing: vi.fn(async () => { if (!online) throw offline(); return { code: 'ABC234', expiresAt: wall + 600, serverTime: wall }; }),
    pairingStatus: vi.fn(async () => { if (!online) throw offline(); return { state: 'waiting', deviceId: null, nonce: null, serverTime: wall }; }),
    heartbeat: vi.fn(async () => { if (!online) throw offline(); return { outcome: 'renewed', serverTime: wall, session: { state: 'playing', volume: 70 }, latest: null, role: 'home' }; }),
    view: vi.fn(async () => { if (!online) throw offline(); return { state: 'open', zone_name: 'Bar', now: { title: 'Song', artist: 'Band' } }; }),
    horizon: vi.fn(async () => { if (!online) throw offline(); return { zone_id: 'z', version: 'v1', segments: [], schedule: { periods: [OPEN] }, issued_at: wall - 10, valid_until: wall + 7 * 86_400, offline_bundle: over.bundle }; }),
    health: vi.fn(async (_report: unknown) => { if (!online) throw offline(); }),
    resync: vi.fn(async () => ({ inserted: 0, duplicates: 0 })),
    segmentUrl: vi.fn(async (k: string) => k),
    checkPin: vi.fn(async () => false),
  };
  const screens: KioskScreen[] = [];
  const key = { publicKey: 'pk', machineId: 'm', sign: async () => 's', forget: vi.fn(async () => undefined) };
  const deps: ControllerDeps = {
    api: api as unknown as KioskApi, key, cache, clock, audio,
    wake: { sync: vi.fn(), held: () => true, supported: () => true },
    log: playLog(null), worker: null, version: '2026.11.1', restart: 'power_or_crash',
    wallNow: () => wall, storage,
    render: (screen) => { screens.push(screen); },
    ...(over.bundle ? { permits: permitStore(null, over.trusted ?? []) } : {}),
  };
  const controller = createController(deps);
  return {
    controller, api, player, screens, cache, storage, key, deps,
    set online(value: boolean) { online = value; },
    advance(seconds: number) { wall += seconds; mono += seconds; },
    last: () => screens[screens.length - 1],
  };
}

describe('kiosk controller', () => {
  it('an unpaired player shows a pairing code and becomes paired when the manager types it', async () => {
    const k = setup();
    await k.controller.boot();
    expect(k.last().kind).toBe('unpaired');
    expect(k.api.startPairing).toHaveBeenCalledWith({ public_key: 'pk', machine_id: 'm' });
    k.api.pairingStatus.mockResolvedValueOnce({ state: 'paired', deviceId: 'd1', nonce: 'n1', serverTime: 10_000 } as never);
    await k.controller.every('heartbeat');
    expect(k.controller.state().paired).toBe(true);
    expect(k.storage.getItem('selectadj-kiosk-paired')).toBe('1');
  });

  it('test_power_cut_restart_resumes_without_a_tap_when_flags_allow', async () => {
    const k = setup({ paired: true, autoplay: true });
    await k.controller.boot();
    expect(k.player.start).toHaveBeenCalledWith(5);
    expect(k.last().kind).toBe('playing');
    const report = k.api.health.mock.calls[0][0] as { restart_reason: string; restarted_at: number };
    expect(report.restart_reason).toBe('power_or_crash');
    expect(report.restarted_at).toBe(10_000);
  });

  it('test_autoplay_blocked_shows_tap_to_start, and one tap lasts', async () => {
    const k = setup({ paired: true, autoplay: false });
    await k.controller.boot();
    expect(k.player.start).not.toHaveBeenCalled();
    expect(k.last().kind).toBe('needs_tap');
    const report = k.api.health.mock.calls[0][0] as { autoplay_allowed: boolean };
    expect(report.autoplay_allowed).toBe(false);
    await k.controller.tap();
    expect(k.player.start).toHaveBeenCalledTimes(1);
    await k.controller.every('tick');
    expect(k.player.start).toHaveBeenCalledTimes(1);
  });

  it('closed shows Closed and plays nothing', async () => {
    const k = setup({ paired: true, wall: 60_000 });
    k.api.view.mockResolvedValue({ state: 'closed', opens_at: '10:00' } as never);
    await k.controller.boot();
    expect(k.player.start).not.toHaveBeenCalled();
    expect(k.last().kind).toBe('closed');
  });

  it('time unknown after a reboot with no network never starts by itself', async () => {
    const k = setup({ paired: true, online: false });
    await k.controller.boot();
    expect(k.player.start).not.toHaveBeenCalled();
    expect(k.last().kind).toBe('needs_tap');
  });

  it('keeps playing from saved music when the internet drops, and stops at the saved close', async () => {
    const k = setup({ paired: true });
    await k.controller.boot();
    expect(k.player.started).toBe(true);
    k.online = false;
    await k.controller.every('heartbeat');
    await k.controller.every('tick');
    expect(k.controller.state().online).toBe(false);
    expect(k.player.started).toBe(true);
    expect(k.last()).toEqual({ kind: 'playing', saved: true });
    k.advance(50_000 - 10_000);
    await k.controller.every('tick');
    expect(k.player.started).toBe(false);
    expect(k.last().kind).toBe('closed');
  });

  it('a revoked player wipes its saved music and shows a pairing code', async () => {
    const k = setup({ paired: true });
    await k.controller.boot();
    k.api.heartbeat.mockRejectedValueOnce(new KioskCallError(401, 'kiosk_revoked'));
    await k.controller.every('heartbeat');
    expect(k.controller.state().paired).toBe(false);
    expect(k.key.forget).toHaveBeenCalled();
    expect(k.cache.entries()).toEqual([]);
    expect(k.last().kind).toBe('unpaired');
  });

  it('a standby that the server refuses stays quiet', async () => {
    const k = setup({ paired: true });
    k.api.heartbeat.mockResolvedValue({ outcome: 'refused', serverTime: 10_000, session: null, latest: null, role: 'standby' } as never);
    await k.controller.boot();
    expect(k.player.start).not.toHaveBeenCalled();
  });
});

describe('kiosk controller with the signed offline bundle (ADR-0446)', () => {
  const v = vectors as unknown as { trusted: string[]; good: SignedBundle; forged: SignedBundle };
  // the vectors' bundle: issued at 1.8e9, open from +1 h to +12 h
  const OPEN_AT = 1_800_000_000 + 7200;

  it('a verified bundle keeps the player playing offline on its own schedule', async () => {
    const k = setup({ paired: true, wall: OPEN_AT, bundle: v.good, trusted: v.trusted });
    await k.controller.boot();
    expect(k.controller.state().permitProblem).toBeNull();
    k.online = false;
    await k.controller.every('heartbeat');
    await k.controller.every('tick');
    expect(k.player.started).toBe(true);
  });

  it('a forged bundle is refused: offline the player does not start from it', async () => {
    const k = setup({ paired: true, wall: OPEN_AT, bundle: v.forged, trusted: v.trusted, autoplay: false });
    await k.controller.boot();
    expect(k.controller.state().permitProblem).toBe('forged');
    k.online = false;
    await k.controller.every('heartbeat');
    await k.controller.tap();
    expect(k.player.started).toBe(false);
  });
});

describe('the horizon the player is given', () => {
  it('drops songs the verified content snapshot refuses, with the seams around them', async () => {
    const k = setup({ paired: true });
    const seg = (id: string, at: number, extra: Partial<PlayableSegment> = {}): PlayableSegment =>
      ({ id, key: id, kind: 'song', starts_at: at, duration_s: 10, bytes: 1, sha256: '', committed: false, ...extra });
    const segments = [seg('a', 0, { song_id: 1 }), seg('a>seam', 10, { kind: 'transition' }), seg('b', 20, { song_id: 2 }), seg('c', 30, { song_id: 3 })];
    k.api.horizon.mockResolvedValue({ zone_id: 'z', version: 'v', segments, schedule: { periods: [OPEN] } } as never);
    const permits = { held: () => ({ content: { version: 3, refused_song_ids: [2] }, periods: [OPEN], permit: { issued_at: 0, valid_until: 1e12, stop_at: null, licence_grace_ends_at: null } }), accept: vi.fn(async () => ({ ok: true })), pin: vi.fn(), clear: vi.fn(), trusted: () => [] };
    const c = createController({ ...k.deps, permits: permits as never });
    await c.boot();
    expect(k.player.segments.map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('guest requests and the on-screen code (ADR-0451)', () => {
  it('a request put into the programme is fetched at once, and marked played when its song plays', async () => {
    const k = setup({ paired: true });
    const extra = k.api as unknown as Record<string, unknown>;
    extra.screenCode = vi.fn(async () => ({ on: true, code: 'K7QD', changes_at: null }));
    extra.nextRequest = vi.fn(async () => ({ id: 'req-1', local_song_id: 7, title: 'Song', artist: 'Band', queued: true }));
    const played = vi.fn(async () => undefined);
    extra.requestPlayed = played;
    const extras: { roomCode: string | null }[] = [];
    const c = createController({ ...k.deps, render: (_s, _v, e) => { extras.push(e); } });
    await c.boot();
    expect(k.api.horizon).toHaveBeenCalledTimes(2); // once at boot, once for the request
    expect(extras[extras.length - 1].roomCode).toBe('K7QD');
    (k.player as unknown as { current: () => unknown }).current = () => ({ song_id: 7 });
    await c.every('tick');
    expect(played).toHaveBeenCalledWith('req-1');
  });
});

describe('resync after an outage (ADR-0446 BZ-0446-09)', () => {
  it('sends where the player is, and reads the replanned horizon', async () => {
    const k = setup({ paired: true });
    const resync = vi.fn(async () => ({ inserted: 0, duplicates: 0, replanned: true }));
    (k.api as unknown as Record<string, unknown>).resync = resync;
    (k.player as unknown as { position: () => unknown }).position = () => ({ segment: { song_index: 2 }, offsetS: 30 });
    await k.controller.boot();
    const before = k.api.horizon.mock.calls.length;
    k.online = false;
    await k.controller.every('heartbeat');
    k.online = true;
    await k.controller.every('heartbeat');
    expect(resync).toHaveBeenCalledWith([], { song_index: 2, offset_ms: 30_000 });
    expect(k.api.horizon.mock.calls.length).toBe(before + 1);
  });
});

describe('kiosk screens and panel', () => {
  it('the view keeps only allowlisted fields', () => {
    const view = sanitiseKioskView({ state: 'open', zone_name: 'Bar', billing_status: 'grace', seats: 3, now_playing: { title: 'A', artist: 'B', isrc: 'X' } });
    expect(view).toEqual({ state: 'open', zone_name: 'Bar', now: { title: 'A', artist: 'B' } });
  });

  it('Tap to start is a real button and the staff panel opens after a 3 s hold', () => {
    const onTap = vi.fn();
    const node = renderScreen({ kind: 'needs_tap' }, {}, { deviceName: 'Bar player', pairingCode: null, onTap });
    (node.querySelector('#k-tap') as HTMLButtonElement).click();
    expect(onTap).toHaveBeenCalled();
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const panel = mountStaffPanel({ host, pinsOn: () => false, checkPin: async () => false, info: () => ({ deviceName: 'Bar player', zone: 'Bar', network: 'online', savedHours: 2, lastSync: null, version: '1' }), onReload: vi.fn(), onShowCode: vi.fn() });
    host.append(panel.corner);
    panel.corner.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(2999);
    expect(panel.isOpen()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(panel.isOpen()).toBe(true);
    panel.destroy();
    vi.useRealTimers();
  });

  it('burn-in protection moves the words a few pixels every 10 minutes, never under Still', () => {
    vi.useFakeTimers();
    const target = document.createElement('div');
    const burn = startBurnIn(() => target, () => true);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(target.style.transform).toContain('translate(');
    document.documentElement.dataset.motion = 'still';
    burn.apply();
    expect(target.style.transform).toBe('');
    delete document.documentElement.dataset.motion;
    burn.stop();
    vi.useRealTimers();
  });
});
