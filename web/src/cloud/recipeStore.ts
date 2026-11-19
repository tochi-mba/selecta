import type { MixData, MixItem, Request, Status } from '../api';

/** The local-first recipe store (ADR-0458 portable recipes, BF-0462-05).
 *
 * A mix made in the browser is a recipe on the server: the ordered catalogue identities and the
 * planned seams, saved as immutable revisions by `/api/local-media/recipes`, so it follows the
 * member to every device that holds the same files. What belongs to this browser alone is kept
 * here, per workspace, in localStorage: which recipe is the current mix (the mix being listened
 * to or shaped right now) and the Make a Mix shaping choices. Both are conveniences: losing them
 * (cleared site data, a private window) loses no mix, because every recipe is still listed on the
 * server. Nothing about audio, files or paths is ever written here or sent.
 */

export type RecipeSong = {
  song_id: number;
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  sha256: string | null;
  in_library: boolean;
  available_on: number;
};
export type RecipeSeam = { into: number; method: string; bars: number; basis: string; intelligent: boolean; reason: string };
export type Recipe = {
  mix_id: string;
  name: string;
  number: number;
  parent: string | null;
  revision: string;
  songs: RecipeSong[];
  seams: RecipeSeam[];
};
export type RecipeSummary = { mix_id: string; name: string; revision: string; number: number; songs: number; updated_at: number };

/** Words for a seam the browser works out as it plays (ADR-0459): nothing is rendered ahead. */
export const WORKED_OUT_LIVE = 'Worked out in your browser as the mix plays.';

const pointerKey = (workspaceId: string) => `selecta-current-recipe:${workspaceId}`;
const steeringKey = (workspaceId: string) => `selecta-steering:${workspaceId}`;

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* not remembered here is fine: the recipe itself is on the server */ }
}

export type RecipeStore = {
  current: () => string | null;
  setCurrent: (mixId: string | null) => void;
  steering: () => Status['steering'];
  setSteering: (next: Status['steering']) => void;
  create: (name: string, songIds: number[]) => Promise<Recipe>;
  read: (mixId: string) => Promise<Recipe>;
  list: () => Promise<RecipeSummary[]>;
  /** A new revision of the recipe: the editor's writes, checked against `baseRevision`. */
  edit: (mixId: string, baseRevision: string, change: { songIds?: number[]; name?: string }) => Promise<Recipe>;
  /** A saved copy under its own id, so "Save a copy" lands in My Mixes. */
  duplicate: (mixId: string, name?: string) => Promise<Recipe>;
};

export const DEFAULT_STEERING: Status['steering'] = { mix_language: 'any', stems: 'auto', energy_arc: null, target: null };

/** The store for one workspace. `cloud` is the authenticated Cloud client (paths without /api). */
export function recipeStore(cloud: Request, workspaceId: string): RecipeStore {
  return {
    current: () => read(pointerKey(workspaceId)),
    setCurrent: (mixId) => write(pointerKey(workspaceId), mixId),
    steering: () => {
      const saved = read(steeringKey(workspaceId));
      if (!saved) return DEFAULT_STEERING;
      try { return { ...DEFAULT_STEERING, ...(JSON.parse(saved) as Partial<Status['steering']>) }; } catch { return DEFAULT_STEERING; }
    },
    setSteering: (next) => write(steeringKey(workspaceId), JSON.stringify(next)),
    create: async (name, songIds) => (await cloud<{ mix: Recipe }>('/local-media/recipes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, song_ids: songIds }),
    })).mix,
    read: async (mixId) => (await cloud<{ mix: Recipe }>(`/local-media/recipes/${encodeURIComponent(mixId)}`)).mix,
    list: async () => (await cloud<{ recipes: RecipeSummary[] }>('/local-media/recipes')).recipes,
    edit: async (mixId, baseRevision, change) => (await cloud<{ mix: Recipe }>(`/local-media/recipes/${encodeURIComponent(mixId)}/revisions`, {
      method: 'POST',
      body: JSON.stringify({
        base_revision: baseRevision,
        ...(change.songIds ? { song_ids: change.songIds } : {}),
        ...(change.name ? { name: change.name } : {}),
      }),
    })).mix,
    duplicate: async (mixId, name) => (await cloud<{ mix: Recipe }>(`/local-media/recipes/${encodeURIComponent(mixId)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    })).mix,
  };
}

/** A recipe as the shared views' current mix. Songs carry no tempo or key (nothing is analysed
 * on the server), and each seam is planned as the browser's own blend, worked out as it plays. */
export function asMixData(recipe: Recipe): MixData {
  const mix: MixItem[] = recipe.songs.map((song, position) => ({
    position,
    song_id: song.song_id,
    artist: song.artist ?? '',
    title: song.title,
    duration: song.duration ?? 0,
    bpm: null,
    key: null,
    locked: false,
    seam: position === 0 ? null : {
      settings: { move: 'blend' },
      state: { status: 'none', key: `${recipe.revision}:${position}`, label: 'Browser blend', why: WORKED_OUT_LIVE },
    },
  }));
  return { mix, name: recipe.name, can_undo: false };
}
