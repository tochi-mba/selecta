/** Browser-native Studio integration boundary (ADR-0485).
 *
 * This module never reads a File, copies media to Cloud, or assumes a Python service.
 * Agent 01 (player), Agent 02 (local media) and Agent 05 (renderer) register their
 * implementations during application composition. A missing port is *not* readiness.
 */
import { useSyncExternalStore } from 'react';

export type StudioRecording = {
  occurrence_id: string;
  canonical_track_id: string | null;
  legacy_asset_id: string | null;
  recording_version: string | null;
  title: string;
  artist: string | null;
  analysis_valid: boolean;
};
export type StudioCue = { occurrence_id: string; at: number; timebase: 'source_seconds' | 'beats'; requires_revalidation: boolean };
export type StudioTransition = {
  from_occurrence_id: string;
  to_occurrence_id: string;
  type: 'cut' | 'crossfade' | 'beatmatched_crossfade' | 'planned';
  duration_seconds: number;
  requires_rebuild: boolean;
};
export type PortableRecipe = {
  schema_version: 2;
  recipe_id: string;
  revision_id: string;
  name: string;
  revision_number: number;
  parent_revision: string | null;
  draft: boolean;
  occurrences: StudioRecording[];
  cues: StudioCue[];
  transitions: StudioTransition[];
};
export type RecipeSummary = {
  recipe_id: string; name: string; revision: string; revision_number: number; occurrences: number;
};
export type RecipeHistoryEntry = {
  revision: string; number: number; name: string;
  schema_version: number; parent_revision: string | null;
};

/** A status is qualified for one particular recipe revision on one actual device.
 * Unknown/missing/alternate versions never authorize playback or rendering. */
export type BrowserMediaState =
  | 'available' | 'preparing' | 'unsupported_here' | 'missing_media'
  | 'permission_required' | 'alternative_master' | 'cache_invalid' | 'unknown';
export type LocalRecordingStatus = {
  occurrenceId: string;
  state: BrowserMediaState;
  reason?: string;
  exactIdentityVerified: boolean;
  verifiedAt?: number;
};
export type BrowserAvailability = {
  recipeId: string;
  revisionId: string;
  deviceId: string;
  verifiedAt: number;
  expiresAt: number;
  outputVerified: boolean;
  tracks: LocalRecordingStatus[];
};
/** Imported files remain inside the local browser media layer. Only opaque, canonical
 * metadata references may be forwarded to the recipe endpoint. */
export type ImportedStudioRecording = {
  canonical_track_id: string;
  recording_version: string | null;
  title: string;
  artist: string | null;
};
export type BrowserMediaPort = {
  deviceId: string;
  importFiles(files: readonly File[]): Promise<ImportedStudioRecording[]>;
  inspect(recipe: PortableRecipe): Promise<BrowserAvailability>;
};
export type BrowserPlaybackPort = {
  status(): { deviceLabel: string; playing: boolean; outputVerified: boolean; detail: string };
  playHere(recipe: PortableRecipe): Promise<void>;
  controlAnotherDevice(): Promise<void>;
};
export type BrowserRenderPort = {
  /** Gate by live device capabilities; can be true on supported phones. */
  supported(recipe: PortableRecipe): { supported: boolean; reason?: string };
  render(recipe: PortableRecipe, options: { signal: AbortSignal }): Promise<{
    filename: string; mimeType: string; blob: Blob;
  }>;
};
export type BrowserStudioPorts = {
  media?: BrowserMediaPort;
  playback?: BrowserPlaybackPort;
  renderer?: BrowserRenderPort;
};

let currentPorts: BrowserStudioPorts = {};
const listeners = new Set<() => void>();
/** Integration owner calls this only with locally executing, validated adapters. */
export function registerBrowserStudioPorts(ports: BrowserStudioPorts | null): () => void {
  const installed = ports ?? {};
  currentPorts = installed;
  listeners.forEach((listener) => listener());
  return () => {
    if (currentPorts === installed) {
      currentPorts = {};
      listeners.forEach((listener) => listener());
    }
  };
}
export function useBrowserStudioPorts(): BrowserStudioPorts {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => currentPorts,
    () => currentPorts,
  );
}

/** Closed on any missing, mismatched, expired, or contradictory evidence. */
export function checkedAvailability(
  recipe: PortableRecipe, availability: BrowserAvailability | null, deviceId: string, now = Date.now(),
) {
  if (!availability || availability.recipeId !== recipe.recipe_id ||
      availability.revisionId !== recipe.revision_id ||
      availability.deviceId !== deviceId ||
      !Number.isFinite(availability.verifiedAt) ||
      !Number.isFinite(availability.expiresAt) ||
      availability.verifiedAt > now + 5000 || availability.expiresAt <= now ||
      availability.tracks.length !== recipe.occurrences.length) {
    return { ready: 0, total: recipe.occurrences.length, allReady: false, outputVerified: false, rows: recipe.occurrences.map(
      (r) => ({ occurrenceId: r.occurrence_id, state: 'unknown' as BrowserMediaState, exactIdentityVerified: false }),
    ) };
  }
  const rows = recipe.occurrences.map((occurrence, index) => {
    const report = availability.tracks[index];
    return report && report.occurrenceId === occurrence.occurrence_id &&
      report.verifiedAt !== undefined && Number.isFinite(report.verifiedAt) &&
      report.verifiedAt <= now + 5000 && report.verifiedAt >= availability.verifiedAt - 120000
      ? report : { occurrenceId: occurrence.occurrence_id, state: 'unknown' as BrowserMediaState, exactIdentityVerified: false };
  });
  const ready = rows.filter((row) => row.state === 'available' && row.exactIdentityVerified).length;
  return {
    ready, total: recipe.occurrences.length, allReady: ready > 0 && ready === rows.length,
    outputVerified: availability.outputVerified === true,
    rows,
  };
}
