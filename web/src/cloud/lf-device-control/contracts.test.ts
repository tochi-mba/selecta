import { describe, expect, it } from 'vitest';
import {
  audibleTruth, isFresh, readinessReason, stageFor, verifiedCount,
  type DeviceReadiness, type LocalDevice, type LocalSession,
} from './contracts';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const iso = (delta = 0) => new Date(NOW + delta).toISOString();
const computer: LocalDevice = {
  device_id: 'pc', name: 'Studio PC', this_device: true, role: 'local_engine',
  connectivity: 'online', last_confirmed_server_at: iso(-1000),
  outputs: [{ id: 'out', name: 'USB DAC', health: 'ready' }],
};
const session: LocalSession = {
  workspace_id: 'ws', speaker_device_id: 'old', speaker_name: 'Old laptop',
  output_id: 'old-out', output_name: 'Headphones', generation: 23, recipe_revision: 'r5',
  state: 'playing', output_state: 'audible', observed_at: iso(-1000),
  original_can_be_fenced: true,
};
const available: DeviceReadiness = {
  target_device_id: 'pc', recipe_revision: 'r5', output_id: 'out',
  status: 'ready', last_verified_at: iso(-1000),
  tracks: [
    { occurrence_id: 'one', state: 'ready', reason: null },
    { occurrence_id: 'two', state: 'ready', reason: null },
  ],
  transition_states: [{ index: 0, state: 'ready' }],
};

describe('LF12 exact local readiness and live output truth', () => {
  it('rejects stale, future, invalid and missing observation timestamps', () => {
    expect(isFresh(iso(-14999), 15000, NOW)).toBe(true);
    expect(isFresh(iso(-15001), 15000, NOW)).toBe(false);
    expect(isFresh(iso(10000), 15000, NOW)).toBe(false);
    expect(isFresh('nonsense', 15000, NOW)).toBe(false);
    expect(isFresh(null, 15000, NOW)).toBe(false);
  });

  it('never confuses cloud lease with actual audible speaker or quiet output', () => {
    expect(audibleTruth(session, NOW)).toBe('Playing on Old laptop · Headphones');
    expect(audibleTruth({ ...session, output_state: 'silent' }, NOW)).toContain('silent');
    expect(audibleTruth({ ...session, observed_at: iso(-60000) }, NOW)).toContain('current sound unverified');
    expect(audibleTruth({ ...session, state: 'paused' }, NOW)).toContain('Paused on');
    expect(audibleTruth(null, NOW)).toBe('No confirmed speaker');
  });

  it('requires a local engine and exact device, output, revision and fresh N/M', () => {
    expect(readinessReason(computer, available, session, 'out', NOW)).toBeNull();
    expect(verifiedCount(available)).toBe('2/2 verified local recordings');
    expect(readinessReason({ ...computer, role: 'controller_only' }, available, session, 'out', NOW)).toContain('controller-only');
    expect(readinessReason({ ...computer, connectivity: 'offline' }, available, session, 'out', NOW)).toContain('offline');
    expect(readinessReason(computer, available, session, 'other', NOW)).toContain('output');
    expect(readinessReason(computer, { ...available, recipe_revision: 'older' }, session, 'out', NOW)).toContain('unknown or stale');
    expect(readinessReason(computer, { ...available, last_verified_at: iso(-40000) }, session, 'out', NOW)).toContain('unknown or stale');
    expect(readinessReason(computer, { ...available, tracks: [] }, session, 'out', NOW)).toContain('No recordings');
  });

  it.each(['missing', 'candidate_match', 'source_disconnected', 'version_mismatch', 'permission_required', 'unsupported', 'policy_blocked', 'cache_invalid'] as const)(
    'refuses takeover for %s local recording rather than creating a cloud stream', (state) => {
      const report: DeviceReadiness = { ...available, status: 'needs_attention', tracks: [
        available.tracks[0], { occurrence_id: 'two', state, reason: 'requires attention' },
      ] };
      expect(readinessReason(computer, report, session, 'out', NOW)).toContain('1 local recordings');
      expect(verifiedCount(report)).toBe('1/2 verified local recordings');
    },
  );

  it('keeps original speaker safe when partitioned or transitions are unprepared', () => {
    expect(readinessReason(computer, available, { ...session, original_can_be_fenced: false }, 'out', NOW)).toContain('Unsafe takeover');
    expect(readinessReason(computer, { ...available, transition_states: [{ index: 0, state: 'requires_local_rebuild' }] }, session, 'out', NOW)).toContain('Transitions');
    expect(readinessReason(computer, available, { ...session, recipe_revision: null }, 'out', NOW)).toContain('Choose a mix');
  });

  it('distinguishes cloud acknowledgement from local application and failure', () => {
    const result = (state: 'accepted' | 'queued' | 'applied' | 'acknowledged' | 'failed' | 'expired') => ({
      operation_id: 'op', state, applied_generation: null, reason: null,
    });
    expect(stageFor(result('accepted'), 'requested')).toBe('queued');
    expect(stageFor(result('queued'), 'prepared')).toBe('queued');
    expect(stageFor(result('applied'), 'queued')).toBe('applied');
    expect(stageFor(result('acknowledged'), 'queued')).toBe('applied');
    expect(stageFor(result('failed'), 'queued')).toBe('failed');
    expect(stageFor(result('expired'), 'queued')).toBe('expired');
  });
});
