import { ApiError, Link, LinkList, MixData, Request } from '../api';
import { flagOn } from '../flags';
import { browserMovesOn, defaultBrowserMove } from './browserMoves';
import { BROWSER_MIX_NEEDS, mixNameFor, type PlayableSong } from './localFirstMixes';
import { asMixData, WORKED_OUT_LIVE, type RecipeStore } from './recipeStore';

/** The Word connections route family of the local-first adapter (ADR-0462 "one adapter per route
 * family"): `GET /links`, `POST /mix/pair` and `POST /mix/undo` the shared Links view asks, and a
 * plain refusal for the `/seams` previews it offers.
 *
 * What a word connection is here, honestly: two of your catalogue songs where one ends a line on
 * the same words the next opens with, found by local mode's own matcher in line-synced lyrics the
 * Cloud API looks up from LRCLIB (artist, title, album and duration only; never audio). Nothing
 * is analysed, so no key, tempo or beat grid backs the pair, and nothing is rendered ahead: adding
 * a pair puts the two songs next to each other in the current browser mix, and the browser works
 * the transition out from the audio as it plays (ADR-0459). It does not cut on the shared word.
 *
 * The whole family answers only while `discover.word_links` is on for the account. That flag
 * requires `lyrics.display`, which stays off in Cloud until the lyric licence is cleared, so with
 * it off every route here falls through to "not here yet", exactly as before.
 */

/** A link as `/api/local-media/links` answers it. */
export type CloudLink = {
  phrase: string; kind: string; a: number; b: number;
  artist_a: string; title_a: string; artist_b: string; title_b: string;
  line_a: string; line_b: string; score: number; moves: string[];
};
export type CloudLinks = {
  links: CloudLink[];
  found: number;
  lyrics: { songs: number; checked: number; synced: number; waiting: number; looked_up: number; looking_up: boolean };
};

export const NO_PREVIEW_HERE = 'Transition previews aren’t made in your browser. Add both songs to your mix and SelectaDJ works the transition out as it plays.';

function refuse(message: string, code: string, status = 400): ApiError {
  return new ApiError(message, status, code, 'device-music:links');
}

/** A Cloud link in the shape the shared Links view reads. Its one move is the browser's own
 * live transition; its state says nothing is rendered, because nothing is. */
export function asLink(link: CloudLink): Link {
  const move = defaultBrowserMove();
  return {
    phrase: link.phrase, kind: link.kind, a: link.a, b: link.b,
    artist_a: link.artist_a, title_a: link.title_a, artist_b: link.artist_b, title_b: link.title_b,
    line_a: link.line_a, line_b: link.line_b,
    // 'auto' is named in status.moves while browser moves are on; with them off there's nothing to choose
    moves: browserMovesOn() ? [move] : [],
    move,
    state: { status: 'none', key: `link:${link.a}:${link.b}`, why: WORKED_OUT_LIVE },
    worked: true,
  };
}

/** The ids with `a` then `b` next to each other: at the end when neither is there, or beside
 * whichever of the two already is (local mode's "Add both to the mix" says the same). */
export function pairInto(ids: readonly number[], a: number, b: number): number[] {
  const next = [...ids];
  const atA = next.indexOf(a);
  const atB = next.indexOf(b);
  if (atA === -1 && atB === -1) return [...next, a, b];
  if (atA !== -1 && atB === -1) { next.splice(atA + 1, 0, b); return next; }
  if (atA === -1) { next.splice(atB, 0, a); return next; }
  if (atB === atA + 1) return next;
  next.splice(atB, 1);
  next.splice(next.indexOf(a) + 1, 0, b);
  return next;
}

/** What one pair changed, so Undo can take back exactly that and nothing after it. */
type PairUndo = { mixId: string; before: number[] | null; after: string };

export type LinksFamily = {
  /** The family's answer, or undefined when the request is not one of its routes. */
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
};

export function linksFamily(cloud: Request, store: RecipeStore | undefined, songs: () => Promise<PlayableSong[]>): LinksFamily {
  let last: PairUndo | null = null;

  const orderHeader = (init?: RequestInit): string | null => {
    try { return new Headers(init?.headers).get('x-mix-order'); } catch { return null; }
  };

  const links = async (query: URLSearchParams): Promise<LinkList> => {
    const ask = new URLSearchParams();
    const q = (query.get('q') ?? '').trim();
    if (q) ask.set('q', q);
    ask.set('limit', String(Math.min(200, Math.max(1, Number(query.get('limit') ?? 60) || 60))));
    if (query.get('song')) ask.set('song', String(Number(query.get('song'))));
    const answer = await cloud<CloudLinks>(`/local-media/links?${ask.toString()}`);
    // nothing is rendered ahead in a browser, so there is no "prepared" count to report
    return { links: answer.links.map(asLink), prepared: 0, preparing: 0 };
  };

  const pair = async (init?: RequestInit): Promise<MixData> => {
    if (!store) throw refuse('This browser keeps no mixes for this account, so a pair can’t be made into one here. Make a Mix works as usual.', 'flag_off', 404);
    const body = JSON.parse(String(init?.body ?? '{}')) as { a?: number; b?: number };
    const a = Number(body.a);
    const b = Number(body.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) throw refuse('That pair isn’t two different songs.', 'bad_pair');
    const all = await songs();
    const playable = (id: number) => all.some((song) => song.id === id && song.playable);
    if (!playable(a) || !playable(b)) {
      throw refuse('Both songs need to play on this device. Connect them here first, then add the pair.', 'not_playable');
    }
    const expected = orderHeader(init);
    const id = store.current();
    if (!id) {
      if (expected) throw refuse('The mix changed under this press, so nothing happened. It has been redrawn.', 'mix_changed', 409);
      const made = await store.create(mixNameFor(all, [a, b]), [a, b]);
      store.setCurrent(made.mix_id);
      last = { mixId: made.mix_id, before: null, after: [a, b].join(',') };
      return { ...asMixData(made), can_undo: true };
    }
    const recipe = await store.read(id);
    const ids = recipe.songs.map((song) => song.song_id);
    if (expected !== null && expected !== ids.join(',')) {
      throw refuse('The mix changed under this press, so nothing happened. It has been redrawn.', 'mix_changed', 409);
    }
    const next = pairInto(ids, a, b);
    if (next.join(',') === ids.join(',')) return asMixData(recipe);
    const edited = await store.edit(id, recipe.revision, { songIds: next });
    last = { mixId: id, before: ids, after: next.join(',') };
    return { ...asMixData(edited), can_undo: true };
  };

  const undo = async (init?: RequestInit): Promise<MixData> => {
    const id = store?.current() ?? null;
    if (!store || !last || !id || last.mixId !== id) throw refuse('There’s nothing here to undo.', 'nothing_to_undo', 409);
    const recipe = await store.read(id);
    const now = recipe.songs.map((song) => song.song_id).join(',');
    const expected = orderHeader(init);
    if (now !== last.after || (expected !== null && expected !== now)) {
      last = null;
      throw refuse('The mix has changed since, so Undo would take back more than that pair. Nothing happened.', 'mix_changed', 409);
    }
    const before = last.before;
    last = null;
    if (before === null) {
      // the pair made this mix: undoing it lets go of the mix the pair made, and only that
      store.setCurrent(null);
      await store.remove(id);
      return { mix: [], name: 'Current mix', can_undo: false };
    }
    if (before.length < BROWSER_MIX_NEEDS) throw refuse('That can’t be undone here.', 'nothing_to_undo', 409);
    return asMixData(await store.edit(id, recipe.revision, { songIds: before }));
  };

  return {
    answer: (method, route, query, init) => {
      if (!flagOn('discover.word_links')) return undefined;
      if (method === 'GET' && route === '/links') return links(query);
      // a draft is not kept in a browser; those pairs fall through to "not here yet"
      if (query.has('draft')) return undefined;
      if (method === 'POST' && route === '/mix/pair') return pair(init);
      // only a pair made here is taken back; any other undo falls through as before
      if (method === 'POST' && route === '/mix/undo') return last ? undo(init) : undefined;
      if (route === '/seams' || route.startsWith('/seams/')) return Promise.reject(refuse(NO_PREVIEW_HERE, 'flag_off', 404));
      return undefined;
    },
  };
}
