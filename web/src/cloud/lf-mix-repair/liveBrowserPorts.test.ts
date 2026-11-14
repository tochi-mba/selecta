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
