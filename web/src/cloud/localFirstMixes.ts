import { ApiError, MixData, SongRow, Status, Suggestion, VibeCard } from '../api';
import { browserMovesAllowed, browserMovesOn } from './browserMoves';
import { asMixData, copyName, RecipeStore, WORKED_OUT_LIVE } from './recipeStore';

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
/** `never`: "Never play" for the account. A mix SelectaDJ builds leaves it out; a person can
 * still choose it as the start or ending, or add it by hand. */
export type PlayableSong = { id: number; title: string; artist: string; duration: number; playable: boolean; never?: boolean };

export const PICK_NAME = 'Your songs, in your browser';
export const PICK_BLURB = `A run through the songs you can play on this device, starting and ending where you choose. ${WORKED_OUT_LIVE}`;
/** A browser mix needs this many playable songs: one transition is the least a mix is. */
export const BROWSER_MIX_NEEDS = 2;

function refuse(message: string, code: string, status = 400): ApiError {
  return new ApiError(message, status, code, 'local-first:mix');
}

export function pickCard(songs: readonly PlayableSong[]): VibeCard {
  const playable = songs.filter((song) => song.playable && !song.never);
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

const MIX_NAME_MAX = 60;

/** A saved browser mix's own name, from its first and last songs, so My Mixes never lists the
 * same title twice for different mixes: "Ocean to Counting the Days". */
export function mixNameFor(songs: readonly PlayableSong[], ids: readonly number[]): string {
  const title = (id: number | undefined) => songs.find((song) => song.id === id)?.title.trim() ?? '';
  const first = title(ids[0]);
  const last = title(ids[ids.length - 1]);
  if (!first || !last) return PICK_NAME;
  const name = first === last ? first : `${first} to ${last}`;
  // The recipe store keeps at most 60 characters (local_media/api.py).
  return name.length > MIX_NAME_MAX ? `${name.slice(0, MIX_NAME_MAX - 1).trimEnd()}…` : name;
}

/** Which songs a browser mix plays, in order: `start` first, the chosen ending last. */
export function chooseSongs(songs: readonly PlayableSong[], count: number, { start, end }: { start?: number | null; end?: number | null } = {}): number[] {
  const playable = songs.filter((song) => song.playable);
  const byTitle = [...playable].sort((one, other) => one.title.localeCompare(other.title) || one.id - other.id).map((song) => song.id);
  const chosen = (id: number | null | undefined) => id !== null && id !== undefined && byTitle.includes(id);
  const ending = chosen(end) && end !== start ? end! : null;
  const first = chosen(start) ? [start!] : [];
  // songs set to Never play fill no gap of their own; a start or ending the person chose still plays
  const never = new Set(playable.filter((song) => song.never).map((song) => song.id));
  const middle = byTitle.filter((id) => id !== start && id !== ending && !never.has(id));
  const room = Math.max(BROWSER_MIX_NEEDS, count) - first.length - (ending === null ? 0 : 1);
  return [...first, ...middle.slice(0, Math.max(0, room)), ...(ending === null ? [] : [ending])];
}

export type MixFamily = {
  /** The family's answer, or undefined when the request is not one of its routes. */
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
  steering: () => Status['steering'];
};

/** `everySong` (ADR-0475 R5): another device is playing, so Request a song looks through the
 * whole account library, not only what this device can play. */
/** ADR-0475 R5: how a search result ranks (0 plays where it would play now, 1 is held on another
 * device, 2 is held nowhere right now) and the words for where it would play, when not here. */
export type SongPlace = (songId: number, playableHere: boolean) => { rank: number; where: string | null };

export function mixFamily(store: RecipeStore, songs: () => Promise<PlayableSong[]>, everySong: () => boolean = () => false, placeOf?: SongPlace): MixFamily {
  const current = async (): Promise<MixData | null> => {
    const id = store.current();
    if (!id) return null;
    try {
      return asMixData(await store.read(id));
    } catch (error) {
      // a recipe that is no longer there (another device, another account) is let go of
      if ((error as { status?: number }).status === 404) store.setCurrent(null);
      throw error;
    }
  };

  const build = async (query: URLSearchParams): Promise<unknown> => {
    const asDraft = query.get('as_draft') === 'true';
    const all = await songs();
    const count = Math.max(BROWSER_MIX_NEEDS, Number(query.get('count') ?? 0) || 20);
    const start = query.get('start') ? Number(query.get('start')) : null;
    const target = store.steering().target;
    const ids = chooseSongs(all, count, { start, end: target ? Number(target) : null });
    if (ids.length < BROWSER_MIX_NEEDS) {
      throw refuse(`A mix needs at least ${BROWSER_MIX_NEEDS} songs you can play on this device. Connect more music first.`, 'not_enough_songs');
    }
    const recipe = await store.create(mixNameFor(all, ids), ids, all);
    // Save draft keeps it in My Mixes without touching what's playing, as local mode's does
    if (asDraft) return { id: 0, mix_id: recipe.mix_id, name: recipe.name, count: ids.length };
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

  // ---------- the editor family (ADR-0462 parity): the same Edit page local mode has, ----------
  // writing new revisions of the current recipe. Reorder, add, remove, clear and Save a copy
  // work here; nothing in them needs analysis or a rendered seam.

  const orderHeader = (init?: RequestInit): string | null => {
    try { return new Headers(init?.headers).get('x-mix-order'); } catch { return null; }
  };

  const editCurrent = async (init: RequestInit | undefined, change: (ids: number[]) => number[]): Promise<MixData> => {
    const id = store.current();
    if (!id) throw refuse('There is no current browser mix to edit. Press Play on Make a Mix first.', 'no_mix', 404);
    const recipe = await store.read(id);
    const ids = recipe.songs.map((song) => song.song_id);
    const expected = orderHeader(init);
    if (expected !== null && expected !== ids.join(',')) {
      throw refuse('The mix changed under this press, so nothing happened. It has been redrawn.', 'mix_changed', 409);
    }
    const next = change(ids);
    if (next.length === ids.length && next.every((songId, at) => songId === ids[at])) return asMixData(recipe);
    if (next.length < BROWSER_MIX_NEEDS) {
      throw refuse(`A browser mix keeps at least ${BROWSER_MIX_NEEDS} songs. To start over, clear the mix instead.`, 'too_few_songs');
    }
    // the songs' names come along, so an edit made offline shows them before the server answers
    return asMixData(await store.edit(id, recipe.revision, { songIds: next }, await songs()));
  };

  // the move into one song (cloud.browser_moves): the same route local mode's editor posts to
  const chooseMove = async (position: number, init?: RequestInit): Promise<MixData> => {
    if (!browserMovesOn()) throw refuse('SelectaDJ can’t change transitions in your browser yet.', 'flag_off', 404);
    const body = JSON.parse(String(init?.body ?? '{}')) as { move?: string };
    const move = body.move ?? 'auto';
    if (!(browserMovesAllowed() as string[]).includes(move)) {
      throw refuse('SelectaDJ in your browser can’t play that move. Choose another, or let SelectaDJ pick.', 'move_unavailable');
    }
    const id = store.current();
    if (!id) throw refuse('There is no current browser mix to change. Press Play on Make a Mix first.', 'no_mix', 404);
    const recipe = await store.read(id);
    const expected = orderHeader(init);
    if (expected !== null && expected !== recipe.songs.map((song) => song.song_id).join(',')) {
      throw refuse('The mix changed under this press, so nothing happened. It has been redrawn.', 'mix_changed', 409);
    }
    if (!(position >= 1 && position < recipe.songs.length)) throw refuse('That transition isn’t in this mix any more.', 'mix_changed', 409);
    return asMixData(await store.edit(id, recipe.revision, { seamMoves: { [position]: move === 'auto' ? null : move } }));
  };

  const suggest = async (query: URLSearchParams): Promise<{ songs: Suggestion[] }> => {
    const wanted = (query.get('q') ?? '').trim().toLowerCase();
    const limit = Math.max(1, Number(query.get('limit') ?? 8) || 8);
    const inMix = new Set<number>();
    const id = store.current();
    if (id) {
      try { for (const song of (await store.read(id)).songs) inMix.add(song.song_id); } catch { /* suggest from the library anyway */ }
    }
    return {
      songs: (await songs())
        .filter((song) => song.playable && !inMix.has(song.id) && `${song.title} ${song.artist}`.toLowerCase().includes(wanted))
        .slice(0, limit)
        .map((song) => ({ song_id: song.id, artist: song.artist, title: song.title, bpm: null, key: null, duration: song.duration, reason: 'Plays on this device', analysed: true })),
    };
  };

  const saveCopy = async (init?: RequestInit): Promise<{ name: string }> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string; copy_current?: boolean };
    if (!body.copy_current) throw refuse('SelectaDJ can’t make that kind of draft in your browser yet.', 'flag_off', 404);
    const id = store.current();
    if (!id) throw refuse('There is no current browser mix to copy. Press Play on Make a Mix first.', 'no_mix', 404);
    // a tidy "… copy" name from the current one; if it cannot be read, the server names the copy
    const name = body.name?.trim() || await store.read(id).then((mix) => copyName(mix.name), () => undefined);
    const made = await store.duplicate(id, name);
    return { name: made.name };
  };

  const destinations = async (query: URLSearchParams): Promise<SongRow[]> => {
    const wanted = (query.get('q') ?? '').trim().toLowerCase();
    const limit = Math.max(1, Number(query.get('limit') ?? 20) || 20);
    const all = everySong();
    // R5: with another device playing, songs it can play first, then songs on another device,
    // then songs on no device now; without placings, what this device can play itself first
    const place = (song: PlayableSong) => (all && placeOf ? placeOf(song.id, song.playable) : { rank: song.playable ? 0 : 1, where: null });
    return (await songs())
      .filter((song) => (all || song.playable) && `${song.title} ${song.artist}`.toLowerCase().includes(wanted))
      .map((song) => ({ song, at: place(song) }))
      .sort((one, other) => one.at.rank - other.at.rank || Number(other.song.playable) - Number(one.song.playable))
      .slice(0, limit)
      .map(({ song, at }) => ({ id: song.id, artist: song.artist, title: song.title, genre: null, duration: song.duration, bpm: null, camelot: null, lyric_status: null, never: false, priority: false, ...(at.where ? { where: at.where } : {}) }));
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
      if (method === 'GET' && route === '/mix/suggest') return suggest(query);
      if (method === 'POST' && route === '/mix/move') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { source?: number; target?: number };
        return editCurrent(init, (ids) => {
          const source = Number(body.source);
          const target = Number(body.target);
          if (!Number.isInteger(source) || !Number.isInteger(target) || source < 0 || source >= ids.length || target < 0 || target >= ids.length) {
            throw refuse('That position isn’t in this mix any more.', 'mix_changed', 409);
          }
          const next = [...ids];
          const [moved] = next.splice(source, 1);
          next.splice(target, 0, moved);
          return next;
        });
      }
      if (method === 'POST' && route === '/mix/songs') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { song_id?: number; position?: number };
        return (async () => {
          const all = await songs();
          const song = all.find((one) => one.id === Number(body.song_id));
          if (!song || !song.playable) throw refuse('Choose a song that plays on this device.', 'not_playable');
          return editCurrent(init, (ids) => {
            const next = [...ids];
            const at = Number.isInteger(body.position) ? Math.max(0, Math.min(ids.length, Number(body.position))) : ids.length;
            next.splice(at, 0, song.id);
            return next;
          });
        })();
      }
      if (method === 'DELETE' && /^\/mix\/songs\/\d+$/.test(route)) {
        const position = Number(route.split('/').pop());
        return editCurrent(init, (ids) => {
          if (position < 0 || position >= ids.length) throw refuse('That position isn’t in this mix any more.', 'mix_changed', 409);
          return ids.filter((_, at) => at !== position);
        });
      }
      // ADR-0475 R4: the whole order at once, as another device changed it. Every song must play
      // here, because this device is the one making the sound.
      if (method === 'PUT' && route === '/mix/order') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { song_ids?: number[] };
        return (async () => {
          const wanted = (body.song_ids ?? []).map(Number);
          const all = await songs();
          const missing = wanted.find((id) => !all.some((one) => one.id === id && one.playable));
          if (missing !== undefined) throw refuse('One of those songs doesn’t play on this device.', 'not_playable');
          return editCurrent(init, () => wanted);
        })();
      }
      if (method === 'POST' && route === '/mix/clear') {
        return (async () => {
          const id = store.current();
          if (id) {
            const expected = orderHeader(init);
            if (expected !== null) {
              const recipe = await store.read(id).catch(() => null);
              if (recipe && expected !== recipe.songs.map((song) => song.song_id).join(',')) {
                throw refuse('The mix changed under this press, so nothing was cleared. It has been redrawn.', 'mix_changed', 409);
              }
            }
          }
          // the saved recipe stays in My Mixes; only the current pointer is let go of
          store.setCurrent(null);
          return { mix: [], name: 'Current mix', can_undo: false } as MixData;
        })();
      }
      if (method === 'POST' && route === '/drafts') return saveCopy(init);
      if (method === 'POST' && /^\/mix\/\d+\/seam$/.test(route)) return chooseMove(Number(route.split('/')[2]), init);
      return undefined;
    },
  };
}
