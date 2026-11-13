import { describe, expect, it } from 'vitest';
import type { Api } from '../api';
import { CloudError } from '../api';
import {
  claimSpeaker, parsePersonalSnapshot, personalEnabled, readPersonalSnapshot,
  recentCheck, requestLocalScan, safeLabel, verificationWords,
} from './contract';

const ISO = '2026-11-13T21:00:00Z';
function example() {
  return {
    schema_version: 1,
    devices: [
      { id: 'desk-1', display_name: 'Studio PC', role: 'engine', connectivity: 'online', engine_state: 'ready', output_state: 'verified', last_verified_at: ISO, verified_tracks: 5, total_tracks: 8 },
      { id: 'phone-2', display_name: 'Phone', role: 'controller', connectivity: 'online' },
    ],
    sources: [
      { id: 'drive1', device_id: 'desk-1', display_name: 'External Music', state: 'source_disconnected', last_scanned_at: ISO, total_tracks: 0 },
    ],
    recent_recipes: [
      { recipe_id: 'mix1', revision_id: 'rev1', title: 'Evening mix', target_device_id: 'desk-1', status: 'version_mismatch', verified_tracks: 5, total_tracks: 8, last_verified_at: ISO },
    ],
    playback_owner: { device_id: 'desk-1', output_name: 'Speakers', status: 'playing' },
    local_storage: [{ device_id: 'desk-1', used_bytes: 2000, free_bytes: 1000, cache_bytes: 100 }],
  };
}

describe('LF10 metadata-only boundary', () => {
  it('is explicitly gated, retaining the old UI until enabled', () => {
    expect(personalEnabled(null)).toBe(false);
    expect(personalEnabled({ features: {} } as never)).toBe(false);
    expect(personalEnabled({ features: { 'local_first.personal': true } } as never)).toBe(true);
  });
  it('preserves per-device status, partial readiness, and hardware diagnostics', () => {
    const answer = parsePersonalSnapshot(example());
    expect(answer.devices.map((device) => device.role)).toEqual(['engine', 'controller']);
    expect(answer.devices[0].checkedTracks).toBe(5);
    expect(answer.sources[0].state).toBe('source_disconnected');
    expect(answer.recentRecipes[0].status).toBe('version_mismatch');
    expect(answer.playback?.deviceId).toBe('desk-1');
    expect(answer.storage[0].cacheBytes).toBe(100);
  });
  it('does not leak local paths, hashes, fingerprints or arbitrary service fields', () => {
    const hostile = example();
    hostile.devices[0].display_name = 'C:\\Users\\private\\music';
    hostile.sources[0].display_name = '/home/me/Private';
    hostile.playback_owner.output_name = '\\\\server\\private';
    hostile.recent_recipes[0].title = '/Users/me/Secret Mix';
    const answer = parsePersonalSnapshot({ ...hostile, raw_audio: 'PRIVATE_BYTES', raw_fingerprint: 'SECRET', device_path: '/mnt/private' });
    const rendered = JSON.stringify(answer);
    for (const secret of ['C:\\Users', '/home/', '\\\\server', '/Users/', 'PRIVATE_BYTES', 'SECRET', '/mnt/']) {
      expect(rendered).not.toContain(secret);
    }
    expect(answer.sources[0].label).toBe('Local music source');
    expect(safeLabel('DJ Studio', 'fallback')).toBe('DJ Studio');
  });
  it('defaults to unknown, not ready, when the engine does not verify a field', () => {
    const answer = parsePersonalSnapshot({ schema_version: 1, devices: [{ id: 'd', display_name: 'Device', engine_state: 'amazing', output_state: 'great' }], recent_recipes: [{ recipe_id: 'm', revision_id: 'r', status: 'made-up' }] });
    expect(answer.devices[0].engine).toBe('unknown');
    expect(answer.devices[0].output).toBe('unknown');
    expect(answer.recentRecipes[0].status).toBe('unknown');
    expect(() => parsePersonalSnapshot({ schema_version: 9, devices: [] })).toThrow(/unsupported snapshot version/);
  });
  it('recognises stale or future timestamps without claiming readiness', () => {
    expect(recentCheck(ISO, Date.parse(ISO) + 100_000)).toBe(true);
    expect(recentCheck(ISO, Date.parse(ISO) + 500_000)).toBe(false);
    expect(recentCheck(ISO, Date.parse(ISO) - 60_000)).toBe(false);
    expect(verificationWords(null)).toContain('Never verified');
    expect(verificationWords(ISO, Date.parse(ISO) + 500_000)).toContain('stale');
  });
  it('only fetches approved metadata and sends a bounded pairing credential', async () => {
    const calls: { path: string; init?: RequestInit; ws?: string }[] = [];
    const api: Api = async <T,>(path: string, init?: RequestInit, ws?: string) => {
      calls.push({ path, init, ws });
      return example() as T;
    };
    await readPersonalSnapshot(api, 'ws', new AbortController().signal);
    await claimSpeaker(api, 'ws', ' abc-123 ');
    await requestLocalScan(api, 'ws', 'desk-1');
    expect(calls.map((call) => call.path)).toEqual([
      '/local-first/personal/snapshot', '/local-first/pairings/claim', '/local-first/devices/desk-1/scan',
    ]);
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[1].init?.body).toBe(JSON.stringify({ schema_version: 1, code: 'ABC-123' }));
    expect(calls[2].init?.body).toBe(JSON.stringify({ schema_version: 1 }));
    await expect(claimSpeaker(api, 'ws', '/home/secret')).rejects.toThrow(/pairing code/);
    await expect(requestLocalScan(api, 'ws', '../other')).rejects.toThrow(/known local engine/);
    expect(calls).toHaveLength(3);
  });
  it('keeps service-not-implemented distinguishable from missing local music', () => {
    const err = new CloudError('unavailable', 404);
    expect(err.status).toBe(404);
    expect(parsePersonalSnapshot({ schema_version: 1, devices: [], sources: [] }).sources).toEqual([]);
  });
});
