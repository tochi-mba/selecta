// ADR-0454 "Kiosk and offline" cases that live in the kiosk's own code (BZ-0454-02). Each test
// is named after its ADR-0454 entry.
import { describe, expect, it } from 'vitest';
import { createZoneCache, memoryBlobStore, type Manifest, type Segment } from '../business/offline/zoneCache';
import { startupAction, dayStateAt } from './startup';
import { kioskScreen } from './state';
import { updateDecision } from './update';
import type { KioskView } from './view';

const NOW = 1_800_000_000;
const OPEN = [{ opens_at: NOW - 3600, closes_at: NOW + 3600 }];
const view = (extra: Partial<KioskView> = {}) => ({ state: 'open', now: { title: 'Song', artist: 'Artist' }, ...extra }) as unknown as KioskView;

describe('ADR-0454 kiosk and offline', () => {
  it('test_power_cut_restart_resumes_without_a_tap_when_flags_allow', () => {
    const day = dayStateAt(OPEN, NOW).state;
    expect(startupAction({ paired: true, clock: 'trusted', day, autoplayAllowed: true })).toEqual({ kind: 'resume', fadeInS: 5 });
    // a power return in the night with no trusted time never wakes the street
    expect(startupAction({ paired: true, clock: 'untrusted', day, autoplayAllowed: true })).toEqual({ kind: 'tap', reason: 'time_unknown' });
  });

  it('test_autoplay_blocked_shows_tap_to_start', () => {
    expect(startupAction({ paired: true, clock: 'trusted', day: 'open', autoplayAllowed: false })).toEqual({ kind: 'tap', reason: 'autoplay' });
    const facts = { paired: true, online: true, audioUnlocked: false, savedHoursAhead: 4, now: NOW * 1000 };
    expect(kioskScreen(view(), facts as never)).toEqual({ kind: 'needs_tap' });
  });

  it('test_device_storage_cap_evicts_oldest_played_first', async () => {
    const clock = { now: NOW };
    const cache = createZoneCache({ store: memoryBlobStore(), capBytes: 400, now: () => clock.now, hash: async () => null });
    const seg = (i: number, committed = false): Segment => ({ id: `s${i}`, key: `art/${i}`, starts_at: NOW + i * 240, duration_s: 240, bytes: 100, sha256: `h${i}`, committed });
    const segments = [0, 1, 2, 3, 4].map((i) => seg(i));
    const manifest: Manifest = { zone_id: 'z1', version: 'v1', segments };
    await cache.setManifest(manifest);
    for (const s of segments.slice(0, 4)) await cache.put(s, new Blob([new Uint8Array(100)]));
    await cache.markPlayed(segments[1], NOW + 10); // played first
    await cache.markPlayed(segments[0], NOW + 20); // played later
    expect((await cache.put(segments[4], new Blob([new Uint8Array(100)]))).ok).toBe(true);
    expect(cache.has(segments[1])).toBe(false); // the oldest played file went
    expect(cache.has(segments[0])).toBe(true);
    expect(cache.has(segments[2]) && cache.has(segments[3]) && cache.has(segments[4])).toBe(true);
  });

  it('test_auto_update_waits_for_closed_hours', () => {
    const latest = { version: '2026.12.1', urgent: false };
    expect(updateDecision({ running: '2026.11.1', latest, day: 'open', atFadeBoundary: true, ready: true }).activate).toBe(false);
    expect(updateDecision({ running: '2026.11.1', latest, day: 'warming', atFadeBoundary: true, ready: true }).activate).toBe(false);
    expect(updateDecision({ running: '2026.11.1', latest, day: 'closed', atFadeBoundary: false, ready: true })).toEqual({ activate: true, urgent: false });
    const urgent = { version: '2026.12.2', urgent: true };
    expect(updateDecision({ running: '2026.11.1', latest: urgent, day: 'open', atFadeBoundary: false, ready: true }).activate).toBe(false);
    expect(updateDecision({ running: '2026.11.1', latest: urgent, day: 'open', atFadeBoundary: true, ready: true })).toEqual({ activate: true, urgent: true });
  });
});
