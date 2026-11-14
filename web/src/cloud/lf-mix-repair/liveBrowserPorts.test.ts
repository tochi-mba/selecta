import { describe, expect, it } from 'vitest';
import { liveBrowserStudioPorts } from './liveBrowserPorts';
import type { PortableRecipe } from './browserPorts';

const recipe: PortableRecipe = {
  schema_version: 2, recipe_id: 'recipe_missing', revision_id: 'c'.repeat(64),
  revision_number: 1, parent_revision: null, draft: false, name: 'Missing master',
  occurrences: [{
    occurrence_id: 'missing_1', canonical_track_id: 'opaque_track_1',
    recording_version: 'local_version_1', legacy_asset_id: null,
    title: 'Not on this device', artist: null, analysis_valid: false,
  }],
  cues: [], transitions: [],
};

describe('BR64 cross-agent production browser Studio port composition', () => {
  it('reports absent local media and refuses to claim sound based on recipe metadata', async () => {
    const ports = liveBrowserStudioPorts('br64-missing-sources');
    const status = await ports.media!.inspect(recipe);
    expect(status.tracks[0]).toMatchObject({
      occurrenceId: 'missing_1', state: 'missing_media', exactIdentityVerified: false,
    });
    expect(status.outputVerified).toBe(false);
    expect(ports.playback!.status().playing).toBe(false);
  });
  it('refuses to play or render an arrangement with missing or misordered transitions', async () => {
    const ports = liveBrowserStudioPorts('br64-transition-order');
    const second = {
      ...recipe.occurrences[0], occurrence_id: 'second', canonical_track_id: 'track_2',
      recording_version: 'version_2', title: 'Second recording',
    };
    const missing: PortableRecipe = { ...recipe, occurrences: [...recipe.occurrences, second] };
    expect(ports.renderer!.supported(missing)).toMatchObject({ supported: false });
    await expect(ports.playback!.playHere(missing)).rejects.toThrow(/explicit saved transition/);
    const wrong: PortableRecipe = {
      ...missing, transitions: [{
        from_occurrence_id: 'second', to_occurrence_id: 'missing_1',
        type: 'crossfade', duration_seconds: 3, requires_rebuild: false,
      }],
    };
    expect(ports.renderer!.supported(wrong)).toMatchObject({ supported: false });
    await expect(ports.playback!.playHere(wrong)).rejects.toThrow(/transition order/);
  });

  it('never pretends the live browser player honours nonzero source cues', async () => {
    const ports = liveBrowserStudioPorts('br64-cue-accuracy');
    const cued: PortableRecipe = {
      ...recipe, cues: [{
        occurrence_id: 'missing_1', at: 12.5,
        timebase: 'source_seconds', requires_revalidation: false,
      }],
    };
    await expect(ports.playback!.playHere(cued)).rejects.toThrow(/cue-accurate playback/);
  });

  it('rejects unqualified beatmatch and beat cues without doing hosted processing', async () => {
    const ports = liveBrowserStudioPorts('br64-advanced-deny');
    const unsafe: PortableRecipe = {
      ...recipe,
      cues: [{ occurrence_id: 'missing_1', at: 16, timebase: 'beats', requires_revalidation: false }],
    };
    expect(ports.renderer!.supported(unsafe).supported).toBe(false);
    await expect(ports.playback!.playHere(unsafe)).rejects.toThrow(/Beat-based cues/);
  });
});
