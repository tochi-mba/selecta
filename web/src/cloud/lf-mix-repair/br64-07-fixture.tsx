/** Synthetic metadata-only fixture, not a production renderer or a playback implementation. */
import { createRoot } from 'react-dom/client';
import type { Api } from '../api';
import { BrowserStudio } from './BrowserStudio';
import {
  registerBrowserStudioPorts, type BrowserAvailability, type BrowserStudioPorts,
  type PortableRecipe, type RecipeHistoryEntry,
} from './browserPorts';
import '../cloud.css';

type Mode = 'five_of_eight' | 'all_ready' | 'permission_required' | 'alternative_master' | 'unsupported_here' | 'offline';
let mode: Mode = 'five_of_eight';
let saved: PortableRecipe = {
  schema_version: 2, recipe_id: 'synthetic_mix', revision_id: 'a'.repeat(64),
  revision_number: 1, parent_revision: null, name: 'Eight-song demo', draft: true,
  occurrences: Array.from({ length: 8 }, (_, i) => ({
    occurrence_id: `occ_${i}`, canonical_track_id: `canon_${i}`,
    legacy_asset_id: null, recording_version: 'master_v1',
    title: `Synthetic Track ${i + 1}`, artist: null, analysis_valid: false,
  })),
  cues: [], transitions: Array.from({ length: 7 }, (_, i) => ({
    from_occurrence_id: `occ_${i}`, to_occurrence_id: `occ_${i + 1}`,
    type: 'crossfade' as const, duration_seconds: 8, requires_rebuild: true,
  })),
};
let history: RecipeHistoryEntry[] = [{
  revision: saved.revision_id, number: 1, name: saved.name, schema_version: 2, parent_revision: null,
}];
const requests: Array<{ path: string; body?: unknown }> = [];
let playCalls = 0, renderCalls = 0, previewCalls = 0;
let shouldConflict = false;
const api: Api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
  requests.push({ path, body });
  if (path === '/cloud-mixes?schema_version=2') return {
    recipes: [{ recipe_id: saved.recipe_id, name: saved.name, revision: saved.revision_id,
      revision_number: saved.revision_number, occurrences: saved.occurrences.length }],
  } as T;
  if (path === '/cloud-mixes/synthetic_mix?schema_version=2') return {
    recipe: saved, history, legacy_read_only_view: false,
  } as T;
  if (path === '/cloud-mixes/synthetic_mix/revisions' && body) {
    if (shouldConflict || body.base_revision !== saved.revision_id) {
      throw Object.assign(new Error('A newer revision exists'), { status: 409 });
    }
    const changes = (body.changes ?? {}) as Partial<PortableRecipe>;
    const parent = saved.revision_id;
    saved = { ...saved, ...changes, revision_number: saved.revision_number + 1,
      parent_revision: parent, revision_id: saved.revision_number.toString(16).padStart(64, '0') };
    history = [{
      revision: saved.revision_id, number: saved.revision_number, name: saved.name,
      schema_version: 2, parent_revision: parent,
    }, ...history];
    return { recipe: saved } as T;
  }
  throw new Error('Fixture refused unexpected endpoint ' + path);
};

function status(recipe: PortableRecipe): BrowserAvailability {
  const now = Date.now();
  return {
    recipeId: recipe.recipe_id, revisionId: recipe.revision_id,
    deviceId: 'browser_phone', verifiedAt: now - 250, expiresAt: now + 30000,
    outputVerified: mode === 'all_ready',
    tracks: recipe.occurrences.map((track, index) => {
      const good = mode === 'all_ready' || (mode === 'five_of_eight' && index < 5);
      const state = good ? 'available' as const : mode === 'permission_required'
        ? 'permission_required' as const : mode === 'alternative_master'
        ? 'alternative_master' as const : mode === 'unsupported_here'
        ? 'unsupported_here' as const : 'missing_media' as const;
      return { occurrenceId: track.occurrence_id, canonicalTrackId: track.canonical_track_id,
        recordingVersion: track.recording_version, state,
        verifiedAt: now - 250, exactIdentityVerified: good };
    }),
  };
}

function ports(): BrowserStudioPorts {
  if (mode === 'offline') return {};
  return {
    media: {
      deviceId: 'browser_phone',
      inspect: async (recipe) => status(recipe),
      importFiles: async () => [],
    },
    playback: {
      status: () => ({ deviceLabel: 'Synthetic phone browser', playing: false,
        outputVerified: mode === 'all_ready', detail: 'Fixture: physical audio not tested' }),
      playHere: async () => { playCalls += 1; },
      previewTransition: async () => { previewCalls += 1; },
      controlAnotherDevice: async () => undefined,
    },
    renderer: {
      supported: () => ({ supported: mode !== 'unsupported_here', reason: 'Synthetic fixture; not a codec test' }),
      prepare: async () => undefined,
      render: async () => {
        renderCalls += 1;
        // A tiny synthetic RIFF header tests the download plumbing, not DSP or valid music.
        const bytes = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
          16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0,
          100, 97, 116, 97, 0, 0, 0, 0]);
        return { filename: 'synthetic-fixture.wav', mimeType: 'audio/wav', blob: new Blob([bytes], { type: 'audio/wav' }) };
      },
    },
  };
}
registerBrowserStudioPorts(ports());
declare global {
  interface Window {
    br64Fixture?: {
      setMode(mode: Mode): void;
      setConflict(active: boolean): void;
      requests: typeof requests;
      counts(): { play: number; render: number; preview: number };
    };
  }
}
window.br64Fixture = {
  setMode(next: Mode) { mode = next; registerBrowserStudioPorts(ports()); },
  setConflict(next: boolean) { shouldConflict = next; },
  requests,
  counts: () => ({ play: playCalls, render: renderCalls, preview: previewCalls }),
};
createRoot(document.getElementById('root')!).render(<BrowserStudio api={api} workspaceId="fixture_workspace" />);
