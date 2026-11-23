import type { MixData, MixItem, Request, Status } from '../api';
import { BROWSER_MOVE_WORDS, browserMovesOn, defaultBrowserMove, type BrowserMove } from './browserMoves';
import { withOutbox, type KnownSong, type RecipeChange } from './outbox';

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
/** `settings.move` is the member's chosen move for this seam (cloud.browser_moves); none means SelectaDJ picks. */
export type RecipeSeam = { into: number; method: string; bars: number; basis: string; intelligent: boolean; reason: string; settings?: { move?: string } };
export type Recipe = {
  mix_id: string;
  name: string;
  number: number;
  parent: string | null;
  revision: string;
  songs: RecipeSong[];
  seams: RecipeSeam[];
};
/** `pending`: made or changed in this browser while offline and not yet on the server (cloud.mix_outbox). */
export type RecipeSummary = { mix_id: string; name: string; revision: string; number: number; songs: number; updated_at: number; pending?: boolean };

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
  /** `known` names the songs, so a mix made while offline can be shown before the server answers. */
  create: (name: string, songIds: number[], known?: readonly KnownSong[]) => Promise<Recipe>;
  read: (mixId: string) => Promise<Recipe>;
  list: () => Promise<RecipeSummary[]>;
  /** A new revision of the recipe: the editor's writes, checked against `baseRevision`. */
  edit: (mixId: string, baseRevision: string, change: RecipeChange, known?: readonly KnownSong[]) => Promise<Recipe>;
  /** A saved copy under its own id, so "Save a copy" lands in My Mixes. */
  duplicate: (mixId: string, name?: string) => Promise<Recipe>;
  /** Delete a saved recipe and all its revisions. Music files are never touched. */
  /** 'queued': deleted here while offline and sent on reconnect; `restore` takes it back until then. */
  remove: (mixId: string) => Promise<void | 'queued'>;
  restore?: (mixId: string) => Promise<void>;
  /** Send changes made while offline (cloud.mix_outbox); resolves once this attempt is over. */
  flush?: () => Promise<void>;
};

/** The longest name a saved mix may have (the server's own limit, `mix_contract.NAME_LIMIT`). */
export const MIX_NAME_LIMIT = 60;
const COPY_SUFFIX = ' copy';
/** A copy's name: the original's with " copy", shortened with an ellipsis instead of being cut
 * mid-word when the two together would pass the limit. */
export function copyName(name: string): string {
  const room = MIX_NAME_LIMIT - COPY_SUFFIX.length;
  const letters = [...name];
  return `${letters.length > room ? `${letters.slice(0, room - 1).join('').trimEnd()}…` : name}${COPY_SUFFIX}`;
}

export const DEFAULT_STEERING: Status['steering'] = { mix_language: 'any', stems: 'auto', energy_arc: null, target: null };

/** The store for one workspace. `cloud` is the authenticated Cloud client (paths without /api). */
export function recipeStore(cloud: Request, workspaceId: string): RecipeStore {
  // cloud.mix_outbox: changes that can't reach the server wait in this browser (outbox.ts)
  return withOutbox(serverRecipes(cloud, workspaceId), workspaceId);
}

function serverRecipes(cloud: Request, workspaceId: string): RecipeStore {
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
        ...(change.seamMoves ? { seam_moves: change.seamMoves } : {}),
      }),
    })).mix,
    duplicate: async (mixId, name) => (await cloud<{ mix: Recipe }>(`/local-media/recipes/${encodeURIComponent(mixId)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    })).mix,
    remove: async (mixId) => {
      await cloud(`/local-media/recipes/${encodeURIComponent(mixId)}`, { method: 'DELETE' });
    },
  };
}

/** Words for a seam SelectaDJ picks as it plays (cloud.browser_moves). */
export const PICKED_LIVE = 'SelectaDJ picks the move from the audio as the mix plays.';

/** A seam's move and the words the editor shows before it plays: the member's chosen move, or
 * SelectaDJ picking, or (with cloud.browser_moves off) the browser's plain blend. */
export function seamPlan(recipe: Recipe, position: number): { move: string; label: string; why: string } {
  if (!browserMovesOn()) return { move: 'blend', label: 'Browser blend', why: WORKED_OUT_LIVE };
  const chosen = recipe.seams.find((seam) => seam.into === position)?.settings?.move;
  const move = chosen && chosen in BROWSER_MOVE_WORDS ? chosen : defaultBrowserMove();
  if (move === 'auto') return { move, label: 'Picked as it plays', why: PICKED_LIVE };
  return { move, label: BROWSER_MOVE_WORDS[move as BrowserMove | 'blend'].label, why: `You chose this. ${WORKED_OUT_LIVE}` };
}

/** A recipe as the shared views' current mix. Songs carry no tempo or key (nothing is analysed
 * on the server), and each seam carries its move, worked out in the browser as it plays. */
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
    seam: position === 0 ? null : (() => {
      const plan = seamPlan(recipe, position);
      return {
        settings: { move: plan.move },
        state: { status: 'none' as const, key: `${recipe.revision}:${position}`, label: plan.label, why: plan.why },
      };
    })(),
  }));
  return { mix, name: recipe.name, can_undo: false };
}
