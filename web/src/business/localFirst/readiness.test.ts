import { describe, expect, it } from 'vitest';
import { localFleet, localReport, NOW, venue, zone } from '../fixtures';
import { inspectFleet, inspectVenue, inspectZone, localFirstOn, TELEMETRY_STALE_SECONDS } from './readiness';

const scene = (changes: Parameters<typeof localReport>[0] = {}, open = true) =>
  venue('a', 'A', { open_now: open, zones: [zone('a', 'z', 'Main', { local_first: localReport(changes) })] });
const inspect = (changes: Parameters<typeof localReport>[0] = {}, open = true) => {
  const v = scene(changes, open);
  return inspectZone(v.zones[0], v, NOW);
};

describe('LF13 local-first readiness safety', () => {
  it('does not opt older business accounts into the new UI', () => {
    expect(localFirstOn(undefined)).toBe(false);
    expect(localFirstOn({ 'business.local_first': false })).toBe(false);
    expect(localFirstOn({ 'business.local_first': true })).toBe(true);
  });
  it('requires affirmative evidence for healthy output and policy', () => {
    const result = inspect();
    expect(result.state).toBe('healthy');
    expect(result.activationReady).toBe(true);
    expect(result.verified).toBe(12);
    expect(result.required).toBe(12);
  });
  it('reports unknown rather than healthy when old servers omit local evidence', () => {
    const v = venue('v', 'Unknown', { zones: [zone('v', 's', 'Speaker')] });
    expect(inspectZone(v.zones[0], v, NOW).state).toBe('unknown');
    expect(inspectVenue(v, NOW).activationReady).toBe(false);
  });
  it('rejects stale status and future-dated status', () => {
    expect(inspect({ verified_at: NOW - TELEMETRY_STALE_SECONDS - 1 }).state).toBe('unknown');
    expect(inspect({ verified_at: NOW + 31 }).state).toBe('unknown');
    expect(inspect({ verified_at: NOW - TELEMETRY_STALE_SECONDS }).state).toBe('healthy');
  });
  it('never treats unlocked but unverified physical output as healthy', () => {
    const result = inspect({ output: { state: 'playing', physical_verified: false } });
    expect(result.state).toBe('degraded');
    expect(result.issues.some((issue) => issue.kind === 'output')).toBe(true);
  });
  it('identifies an unavailable local music drive', () => {
    const result = inspect({ source: { state: 'disconnected' } });
    expect(result.state).toBe('degraded');
    expect(result.issues.find((issue) => issue.kind === 'source')?.action).toMatch(/Reconnect/);
  });
  it('identifies source permission required and missing recordings', () => {
    expect(inspect({ source: { state: 'permission_required' } }).issues.some((issue) => issue.kind === 'source')).toBe(true);
    const result = inspect({ inventory: { verified: 9, required: 12 } });
    expect(result.state).toBe('degraded');
    expect(result.activationReady).toBe(false);
    expect(result.issues.some((issue) => issue.kind === 'media')).toBe(true);
  });
  it('shows a failed physical speaker as silent during open service', () => {
    const result = inspect({ output: { state: 'failed', physical_verified: false } });
    expect(result.state).toBe('silent');
    expect(result.activationReady).toBe(false);
  });
  it('does not mark a normally closed zone as silent', () => {
    const result = inspect({ output: { state: 'idle', physical_verified: true } }, false);
    expect(result.state).toBe('healthy');
  });
  it('requires an adequate prepared horizon and fallback', () => {
    const result = inspect({ horizon: { committed_minutes: 2, prepared_minutes: 5, planned_minutes: 30, fallback_minutes: 0 } });
    expect(result.state).toBe('degraded');
    expect(result.issues.some((issue) => issue.kind === 'fallback')).toBe(true);
  });
  it('requires a current local agent, approved policy and real offline rehearsal', () => {
    const result = inspect({ engine: { state: 'ready', update_required: true }, policy_approved: false, offline_rehearsed: false });
    expect(result.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['update', 'policy', 'rehearsal']));
    expect(result.activationReady).toBe(false);
  });
  it('does not claim live audio when HQ browser is disconnected', () => {
    const v = scene();
    expect(inspectZone(v.zones[0], v, NOW, true).state).toBe('unknown');
  });
  it('preserves offline playback as last-known, not activation-ready', () => {
    const v = scene({ engine: { state: 'offline_playing' } });
    const result = inspectZone(v.zones[0], v, NOW);
    expect(result.state).toBe('offline');
    expect(result.activationReady).toBe(false);
    expect(result.issues[0].action).toContain('last confirmed');
  });
  it('requires ALL zones at a venue to be ready', () => {
    const v = scene();
    v.zones.push(zone(v.id, 'side', 'Side', { local_first: localReport({ source: { state: 'missing' } }) }));
    expect(inspectVenue(v, NOW).activationReady).toBe(false);
  });
  it('summarises 20 venues with three failing zones and an offline-but-playing venue', () => {
    const result = inspectFleet(localFleet().venues, NOW);
    expect(result.venues).toHaveLength(20);
    expect(result.counts.silent).toBe(1);
    expect(result.counts.degraded).toBe(2);
    expect(result.counts.offline).toBe(1);
    expect(result.counts.healthy).toBe(16);
    expect(result.ready).toBe(16);
  });
});
