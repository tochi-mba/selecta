import { describe, expect, it } from 'vitest';
import {
  acceptReadiness, canAcceptCandidate, capabilitiesFor, countReadiness,
  createTemporaryVariation, invalidateSubstitution, isStale,
  referencesOf, unknownReadiness, type DeviceMixReadiness,
} from '../cloud/lf-mix-repair/readiness';

const NOW = 1_800_000_000_000;
const ORIGINAL = 'immutable-r17';
const SONGS = Array.from({ length: 8 }, (_, index) => ({
  id: index === 7 ? 'same-song-variant' : `recording-${index}`,
  title: `Synthetic Track ${index + 1}`, artist: 'Synthetic',
  occurrence_id: `occ-${index}`, explicit: index % 2 === 0, version: 'original',
}));
const refs = referencesOf(SONGS);
function fixture() {
  return {
    device_id: 'speaker-a', mix_id: 'mix-a', revision: ORIGINAL, checked_at: NOW,
    engine_healthy: true, output_verified: true, policy_allowed: true,
    playback_window_free: true, source_connected: true, local_verification: true,
    tracks: refs.map((track, index) => ({
      occurrence_id: track.occurrenceId,
      state: index < 5 ? 'Ready' : index < 7 ? 'Missing' : 'Candidate',
      verified_at: NOW,
      cue_valid: true, seam_valid: true, preview_valid: true,
      candidate_id: 'some-other-recording', candidate_explicit: false,
      equivalent_verified: false,
    })),
  };
}
function accepted(raw: unknown = fixture()): DeviceMixReadiness {
  const checked = acceptReadiness(raw, {
    deviceId: 'speaker-a', mixId: 'mix-a', revision: ORIGINAL, tracks: refs,
  });
  if (!checked) throw Error('Unexpected invalid fixture');
  return checked;
}
describe('LF11 local-first recipe readiness', () => {
  it('eight-track fixture counts only five exact ready tracks, never two missing or one candidate', () => {
    const summary = countReadiness(accepted(), NOW);
    expect([summary.ready, summary.total, summary.states.Missing, summary.states.Candidate]).toEqual([5, 8, 2, 1]);
    expect(summary.capabilities).toEqual(expect.objectContaining({
      editable: true, renderable: false, playable: false,
    }));
  });
  it('keeps the original recipe unchanged under every repair variation', () => {
    const original = structuredClone(SONGS);
    const variation = createTemporaryVariation('mix-a', ORIGINAL, refs, accepted(), NOW);
    expect(variation).toEqual({
      fromMixId: 'mix-a', originalRevision: ORIGINAL, temporary: true,
      orderedOccurrenceIds: ['occ-0', 'occ-1', 'occ-2', 'occ-3', 'occ-4'],
      skippedOccurrenceIds: ['occ-5', 'occ-6', 'occ-7'],
    });
    expect(SONGS).toEqual(original);
    expect(ORIGINAL).toBe('immutable-r17');
  });
  it('refuses wrong clean/explicit and alternate recording or version candidates', () => {
    const candidate = accepted().tracks[7];
    expect(canAcceptCandidate(refs[7], candidate)).toBe(false);
    expect(canAcceptCandidate(
      { ...refs[7], explicit: false },
      { ...candidate, candidateExplicit: true, equivalentVerified: true, candidateId: refs[7].recordingId },
    )).toBe(false);
    expect(canAcceptCandidate(
      { ...refs[7], explicit: false },
      { ...candidate, candidateExplicit: false, equivalentVerified: true, candidateId: refs[7].recordingId, candidateVersion: refs[7].version },
    )).toBe(true);
  });
  it('cannot consume stale, offline, disconnected-drive, or invalidated caches', () => {
    const healthy = accepted();
    expect(isStale(healthy, NOW + 120_001)).toBe(true);
    expect(countReadiness(healthy, NOW + 120_001).ready).toBe(0);
    expect(isStale({ ...healthy, sourceConnected: false }, NOW)).toBe(true);
    expect(createTemporaryVariation('mix-a', ORIGINAL, refs, { ...healthy, sourceConnected: false }, NOW)).toBeNull();
    const invalidated = invalidateSubstitution(healthy.tracks, 'occ-2');
    expect(invalidated[2].state).toBe('Cache Invalid');
    expect(invalidated[2].previewValid).toBe(false);
    expect(invalidated[3].seamValid).toBe(false);
    expect(healthy.tracks[2].state).toBe('Ready');
  });
  it('never treats mismatched, partial or unordered async responses as verified', () => {
    const params = { deviceId: 'speaker-a', mixId: 'mix-a', revision: ORIGINAL, tracks: refs };
    expect(acceptReadiness({ ...fixture(), revision: 'concurrent-r18' }, params)).toBeNull();
    expect(acceptReadiness({ ...fixture(), device_id: 'speaker-b' }, params)).toBeNull();
    expect(acceptReadiness({ ...fixture(), tracks: fixture().tracks.slice(0, 7) }, params)).toBeNull();
    const reversed = fixture().tracks.reverse();
    expect(acceptReadiness({ ...fixture(), tracks: reversed }, params)).toBeNull();
    expect(unknownReadiness('speaker-a', 'mix-a', ORIGINAL, refs).tracks.every(t => t.state === 'Unknown')).toBe(true);
  });
  it('gates actual playback separately from editable, renderable and auditionable', () => {
    const ready = accepted({
      ...fixture(), tracks: fixture().tracks.map(t => ({ ...t, state: 'Ready' })),
    });
    expect(capabilitiesFor(ready, NOW).playable).toBe(true);
    expect(capabilitiesFor({ ...ready, outputVerified: false }, NOW).playable).toBe(false);
    expect(capabilitiesFor({ ...ready, playbackWindowFree: false }, NOW).playable).toBe(false);
    expect(capabilitiesFor({ ...ready, policyAllowed: false }, NOW).renderable).toBe(false);
  });
});
