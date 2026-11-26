import type { Status } from '../api';
import { accountMeasured, askWithin, planningOn, type Request } from './accountFacts';

/** A browser mix's order from the account's planner (docs/engineering/device-to-account.md).
 *
 * The browser still chooses which songs a mix plays, by today's rule (localFirstMixes.ts
 * `chooseSongs`). With planning on and at least `ORDER_NEEDS` of them measured in the account,
 * `POST /api/planning/order` orders the measured ones the way the Desktop's "make a mix" does,
 * from the same choices: the first song, the ending, and the steering (mix language, stems, energy
 * shape). Songs the account hasn't measured are never dropped: they play after the planned run,
 * in today's order, and the chosen ending stays last. Any failure, refusal or a slow answer past
 * `ORDER_WITHIN_MS` gives today's order, and the member is told nothing.
 */

/** The planner's own least (`planner_core.vibes.MIN_SONGS`); fewer measured songs keep today's order. */
export const ORDER_NEEDS = 6;
/** The planner reads at most this many songs (`cloud_brain.planning.MAX_ORDER_SONGS`). */
export const ORDER_MOST = 60;
/** Planning a mix can take seconds; Make a Mix's own busy state shows meanwhile, never longer. */
export const ORDER_WITHIN_MS = 12_000;

const LANGUAGES = new Set(['balanced', 'seamless', 'punchy', 'wordplay']);
const STEMS = new Set(['never', 'sometimes', 'often']);

/** `never`: songs set to Never play, which the planner leaves out; one chosen as the start or
 * ending keeps its place by today's rule. */
export type OrderChoices = { start: number | null; end: number | null; steering: Status['steering']; never?: ReadonlySet<number> };
/** The order for `ids` (today's), or null for today's order. */
export type OrderPlanner = (ids: readonly number[], choices: OrderChoices) => Promise<number[] | null>;

type OrderAnswer = { order: number[]; not_measured?: number[]; never_play?: number[] };

/** The request body: the measured songs and the choices the planner understands. */
export function orderBody(measured: readonly number[], choices: OrderChoices): Record<string, unknown> {
  const { steering } = choices;
  const body: Record<string, unknown> = { songs: measured, idea: 'pick', count: measured.length };
  if (choices.start !== null && measured.includes(choices.start)) body.start = choices.start;
  if (choices.end !== null && measured.includes(choices.end)) body.end = choices.end;
  if (LANGUAGES.has(steering.mix_language)) body.language = steering.mix_language;
  if (STEMS.has(steering.stems)) body.stems = steering.stems;
  const arc = steering.energy_arc;
  if (arc && arc.length >= 2 && arc.length <= 16 && arc.every((point) => Number.isFinite(point) && point >= 0 && point <= 100)) body.energy_arc = arc;
  return body;
}

/** The final order: the chosen first song, the planned run, the songs left out of it in today's
 * order, then the chosen ending. Every song of `ids` exactly once, nothing else. */
export function mergeOrder(ids: readonly number[], planned: readonly number[], choices: Pick<OrderChoices, 'start' | 'end'>): number[] {
  const wanted = new Set(ids);
  const first = choices.start !== null && ids[0] === choices.start ? choices.start : null;
  const last = choices.end !== null && ids[ids.length - 1] === choices.end && choices.end !== first ? choices.end : null;
  const placed = new Set<number>([first, last].filter((id): id is number => id !== null));
  const run: number[] = [];
  for (const id of planned) {
    if (!wanted.has(id) || placed.has(id)) continue;
    placed.add(id);
    run.push(id);
  }
  const rest = ids.filter((id) => !placed.has(id));
  return [...(first === null ? [] : [first]), ...run, ...rest, ...(last === null ? [] : [last])];
}

/** The planner for one workspace's mixes. */
export function accountOrderPlanner(request: Request, workspaceId: string, within = ORDER_WITHIN_MS): OrderPlanner {
  return async (ids, choices) => {
    if (!planningOn() || ids.length < 2) return null;
    try {
      const started = Date.now();
      const account = await askWithinList(request, workspaceId, within);
      const measured = ids.filter((id) => account.has(id) && !choices.never?.has(id));
      if (measured.length < ORDER_NEEDS || measured.length > ORDER_MOST) return null;
      const left = within - (Date.now() - started);
      if (left <= 0) return null;
      const answer = await askWithin<OrderAnswer>(request, '/planning/order', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(orderBody(measured, choices)),
      }, left);
      if (!Array.isArray(answer?.order) || !answer.order.length) return null;
      return mergeOrder(ids, answer.order, choices);
    } catch {
      // offline, slow, refused (too few that suit, a song gone): today's order, said to no one
      return null;
    }
  };
}

/** The account's measured list, within the same bound as the whole order. */
function askWithinList(request: Request, workspaceId: string, within: number): Promise<Map<number, unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), within); });
  return Promise.race([accountMeasured(request, workspaceId), limit]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}
