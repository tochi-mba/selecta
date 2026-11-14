import { describe, expect, it } from 'vitest';
import { checkedAvailability, type BrowserAvailability, type PortableRecipe } from './browserPorts';

const recipe: PortableRecipe = {
  schema_version: 2, recipe_id: 'recipe_1', revision_id: 'a'.repeat(64),
  name: 'Eight tracks', revision_number: 1, parent_revision: null, draft: true,
  occurrences: Array.from({ length: 8 }, (_, index) => ({
    occurrence_id: `occ_${index}`, canonical_track_id: `track_${index}`,
    legacy_asset_id: null, recording_version: `master_${index}`,
    title: `Track ${index}`, artist: null, analysis_valid: false,
  })), cues: [], transitions: [],
};
const now = 1_700_000_000_000;
const availability: BrowserAvailability = {
  recipeId: recipe.recipe_id, revisionId: recipe.revision_id, deviceId: 'phone_1',
  verifiedAt: now - 5000, expiresAt: now + 30000, outputVerified: false,
  tracks: recipe.occurrences.map((occurrence, index) => ({
    occurrenceId: occurrence.occurrence_id,
    canonicalTrackId: occurrence.canonical_track_id,
    recordingVersion: occurrence.recording_version,
    state: index < 5 ? 'available' as const : 'missing_media' as const,
    exactIdentityVerified: index < 5, verifiedAt: now - 5000,
  })),
};

describe('browser Studio exact-media admission', () => {
  it('allows editing 5/8 while denying complete playback and render', () => {
    const result = checkedAvailability(recipe, availability, 'phone_1', now);
    expect(result.ready).toBe(5);
    expect(result.total).toBe(8);
    expect(result.allReady).toBe(false);
    expect(result.outputVerified).toBe(false);
    expect(result.rows.slice(5).map((row) => row.state)).toEqual([
      'missing_media', 'missing_media', 'missing_media',
    ]);
  });
  it('fails closed for another device or recipe revision or expired evidence', () => {
    expect(checkedAvailability(recipe, availability, 'ipad_1', now).ready).toBe(0);
    expect(checkedAvailability({ ...recipe, revision_id: 'b'.repeat(64) }, availability, 'phone_1', now).ready).toBe(0);
    expect(checkedAvailability(recipe, availability, 'phone_1', now + 30_000).ready).toBe(0);
  });
  it('never counts an alternate master or missing recording identity', () => {
    const bad: BrowserAvailability = {
      ...availability,
      outputVerified: true,
      tracks: availability.tracks.map((track) => ({ ...track, state: 'available', exactIdentityVerified: true })),
    };
    bad.tracks[0] = { ...bad.tracks[0], recordingVersion: 'different_master' };
    bad.tracks[1] = { ...bad.tracks[1], canonicalTrackId: 'different_track' };
    expect(checkedAvailability(recipe, bad, 'phone_1', now).ready).toBe(6);
    expect(checkedAvailability(recipe, bad, 'phone_1', now).allReady).toBe(false);
  });
  it('does not treat legacy unresolved references as playable', () => {
    const legacy: PortableRecipe = {
      ...recipe, occurrences: [{ ...recipe.occurrences[0], canonical_track_id: null, legacy_asset_id: 'old_asset' }],
    };
    const claimed: BrowserAvailability = {
      ...availability, tracks: [availability.tracks[0]],
    };
    expect(checkedAvailability(legacy, claimed, 'phone_1', now).allReady).toBe(false);
  });
});
