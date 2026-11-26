import type { VibeCard } from '../api';
import { accountMeasured, answerWithin, askWithin, planningOn, type Request } from './accountFacts';
import { ORDER_NEEDS, ORDER_WITHIN_MS, orderBody, type OrderChoices } from './accountOrder';
import { rememberFeel } from './mixFeel';

/** The account's idea cards on Make a Mix (T-20261126-408d; docs/engineering/cloud-planning.md).
 *
 * The Desktop's idea cards ("Late night", "Warm up" and the rest) come from its planner over the
 * whole library. Here, with planning on, `POST /api/planning/ideas` is asked over every song this
 * device can play that the account has measured (up to `IDEAS_MOST`, the server's own bound: the
 * cards read numbers only, T-20261126-6e24), and its cards join the browser's own. Building one
 * asks `POST /api/planning/order` with that idea over the same songs, so the planner picks the
 * songs that suit it best and orders them as the Desktop's build does. Off, slow or refused: only the browser's own card, and
 * its build, as before. Sent: song ids and the member's choices, never a file, path or audio. */

export type PlayableLike = { id: number; title: string; playable: boolean; never?: boolean };

export type IdeasPlanner = {
  /** The account's cards for these songs; none when planning is off or can't be had. */
  cards: (songs: readonly PlayableLike[], language?: string) => Promise<VibeCard[]>;
  /** A mix of the idea `key` from these songs: its order and the idea's name, or null. */
  order: (key: string, songs: readonly PlayableLike[], choices: OrderChoices, count: number) => Promise<{ ids: number[]; name: string } | null>;
};

/** The most song ids the cards and a build name (`cloud_brain.idea_songs.MOST_NAMED`). */
export const IDEAS_MOST = 5_000;

/** The songs an idea is planned over: playable here, not set to Never play, measured in the
 * account, by title, at most `IDEAS_MOST`. */
export function ideaSongs(songs: readonly PlayableLike[], measured: ReadonlyMap<number, unknown>): number[] {
  return songs
    .filter((song) => song.playable && !song.never && measured.has(song.id))
    .sort((one, other) => one.title.localeCompare(other.title) || one.id - other.id)
    .slice(0, IDEAS_MOST)
    .map((song) => song.id);
}

const LANGUAGES = new Set(['balanced', 'seamless', 'punchy', 'wordplay']);

export function accountIdeas(request: Request, workspaceId: string, within = ORDER_WITHIN_MS): IdeasPlanner {
  const post = <T,>(path: string, body: unknown, left: number) => askWithin<T>(request, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, left);
  const sample = async (songs: readonly PlayableLike[], started: number) => {
    const measured = await answerWithin(accountMeasured(request, workspaceId), within);
    const ids = ideaSongs(songs, measured);
    return { ids, left: within - (Date.now() - started) };
  };
  return {
    cards: async (songs, language) => {
      if (!planningOn()) return [];
      try {
        const { ids, left } = await sample(songs, Date.now());
        if (ids.length < ORDER_NEEDS || left <= 0) return [];
        const answer = await post<{ ideas?: VibeCard[] }>('/planning/ideas', { songs: ids, ...(language && LANGUAGES.has(language) ? { language } : {}) }, left);
        // the browser's own "pick" card stands for a run through every song here
        return (answer?.ideas ?? []).filter((card) => card && typeof card.key === 'string' && card.key !== 'pick');
      } catch {
        return [];
      }
    },
    order: async (key, songs, choices, count) => {
      if (!planningOn()) return null;
      try {
        const { ids, left } = await sample(songs, Date.now());
        if (ids.length < ORDER_NEEDS || left <= 0) return null;
        const body = { ...orderBody(ids, choices), idea: key, count: Math.max(2, Math.min(count, 100)) };
        const answer = await post<{ order?: number[]; name?: string }>('/planning/order', body, left);
        if (!Array.isArray(answer?.order) || answer.order.length < 2) return null;
        rememberFeel(workspaceId, answer.order, choices.steering.mix_language);
        return { ids: answer.order, name: typeof answer.name === 'string' && answer.name ? answer.name : key };
      } catch {
        return null;
      }
    },
  };
}
