import { ApiError, MixData, SongRow, Status, VibeCard } from '../api';
import { asMixData, RecipeStore, WORKED_OUT_LIVE } from './recipeStore';

/** The mix route family of the local-first adapter (ADR-0462 "one adapter per route family",
 * BF-0462-05): `/vibes`, `/vibes/{key}/build`, `/mix`, `/steer` and the destination search the
 * shared Make a Mix, MixSetup and My Mixes ask, answered from the recipe store.
 *
 * What a browser mix is, honestly: the songs this device can play (its own files, or a hosted
 * copy for a grandfathered account), in an order SelectaDJ can stand behind without analysis
 * (the chosen start first, the chosen ending last, the rest in library order), and every
 * transition worked out in the browser from the audio as it plays (ADR-0459). There is one idea
 * card, not the analysed ideas local mode offers, and it says so.
 */

/** A catalogue song as this family needs it: playable here or not. */
export type PlayableSong = { id: number; title: string; artist: string; duration: number; playable: boolean };

export const PICK_NAME = 'Your songs, in your browser';
export const PICK_BLURB = `A run through the songs you can play on this device, starting and ending where you choose. ${WORKED_OUT_LIVE}`;
/** A browser mix needs this many playable songs: one transition is the least a mix is. */
export const BROWSER_MIX_NEEDS = 2;

function refuse(message: string, code: string, status = 400): ApiError {
  return new ApiError(message, status, code, 'local-first:mix');
}

export function pickCard(songs: readonly PlayableSong[]): VibeCard {
  const playable = songs.filter((song) => song.playable);
  return {
    key: 'pick', name: PICK_NAME, blurb: PICK_BLURB,
    songs: playable.length, ready: playable.length >= BROWSER_MIX_NEEDS,
    needs: Math.max(0, BROWSER_MIX_NEEDS - playable.length),
    artists: [...new Set(playable.map((song) => song.artist))].slice(0, 3),
    group: 'All', family: null, tempo: null, moves: 'Browser blends',
    seconds: playable.reduce((total, song) => total + song.duration, 0),
    basis: [],
  };
}

/** Which songs a browser mix plays, in order: `start` first, the chosen ending last. */
export function chooseSongs(songs: readonly PlayableSong[], count: number, { start, end }: { start?: number | null; end?: number | null } = {}): number[] {
  const playable = songs.filter((song) => song.playable);
  const byTitle = [...playable].sort((one, other) => one.title.localeCompare(other.title) || one.id - other.id).map((song) => song.id);
  const ending = end !== null && end !== undefined && byTitle.includes(end) && end !== start ? end : null;
  const first = start !== null && start !== undefined && byTitle.includes(start) ? [start] : [];
  const middle = byTitle.filter((id) => id !== start && id !== ending);
  const room = Math.max(BROWSER_MIX_NEEDS, count) - first.length - (ending === null ? 0 : 1);
  return [...first, ...middle.slice(0, Math.max(0, room)), ...(ending === null ? [] : [ending])];
}

export type MixFamily = {
  /** The family's answer, or undefined when the request is not one of its routes. */
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
  steering: () => Status['steering'];
};

export function mixFamily(store: RecipeStore, songs: () => Promise<PlayableSong[]>): MixFamily {
  const current = async (): Promise<MixData | null> => {
    const id = store.current();
    if (!id) return null;
    try {
      return asMixData(await store.read(id));
    } catch (error) {
      // a recipe that is no longer there (another device, another account) is let go of
      if (error instanceof ApiError && error.status === 404) store.setCurrent(null);
      throw error;
    }
  };

  const build = async (query: URLSearchParams): Promise<unknown> => {
    if (query.get('as_draft') === 'true') throw refuse('SelectaDJ can’t keep drafts in your browser yet.', 'flag_off', 404);
    const all = await songs();
    const count = Math.max(BROWSER_MIX_NEEDS, Number(query.get('count') ?? 0) || 20);
    const start = query.get('start') ? Number(query.get('start')) : null;
    const target = store.steering().target;
    const ids = chooseSongs(all, count, { start, end: target ? Number(target) : null });
    if (ids.length < BROWSER_MIX_NEEDS) {
      throw refuse(`A mix needs at least ${BROWSER_MIX_NEEDS} songs you can play on this device. Connect more music first.`, 'not_enough_songs');
    }
    const recipe = await store.create(PICK_NAME, ids);
    store.setCurrent(recipe.mix_id);
    return asMixData(recipe);
  };

  const steer = async (init?: RequestInit): Promise<Status['steering']> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; value?: unknown };
    const now = store.steering();
    let next = now;
    if (body.action === 'take_me_to') {
      const id = body.value ? Number(body.value) : null;
      const song = id === null ? undefined : (await songs()).find((one) => one.id === id && one.playable);
      if (id !== null && !song) throw refuse('Choose an ending from the songs you can play on this device.', 'not_playable');
      next = { ...now, target: song ? String(song.id) : null, target_label: song ? `${song.title} by ${song.artist}` : null };
    } else if (body.action === 'mix_language' || body.action === 'stems') {
      next = { ...now, [body.action]: String(body.value ?? '') };
    } else if (body.action === 'energy_arc') {
      next = { ...now, energy_arc: Array.isArray(body.value) ? (body.value as number[]) : null };
    } else {
      throw refuse('SelectaDJ can’t change that in your browser yet.', 'flag_off', 404);
    }
    store.setSteering(next);
    return next;
  };

  const destinations = async (query: URLSearchParams): Promise<SongRow[]> => {
    const wanted = (query.get('q') ?? '').trim().toLowerCase();
    const limit = Math.max(1, Number(query.get('limit') ?? 20) || 20);
    return (await songs())
      .filter((song) => song.playable && `${song.title} ${song.artist}`.toLowerCase().includes(wanted))
      .slice(0, limit)
      .map((song) => ({ id: song.id, artist: song.artist, title: song.title, genre: null, duration: song.duration, bpm: null, camelot: null, lyric_status: null, never: false, priority: false }));
  };

  return {
    steering: store.steering,
    answer: (method, route, query, init) => {
      if (method === 'GET' && route === '/vibes') return songs().then((all) => [pickCard(all)]);
      if (method === 'POST' && /^\/vibes\/[^/]+\/build$/.test(route)) return build(query);
      if (method === 'GET' && route === '/mix' && !query.has('draft')) {
        return current().then((data) => data ?? { mix: [], name: 'Current mix', can_undo: false });
      }
      if (method === 'POST' && route === '/steer') return steer(init);
      if (method === 'GET' && route === '/songs') return destinations(query);
      return undefined;
    },
  };
}
