import type { MixData, Request } from '../api';
import { flagListed } from '../flags';
import { canHeal, classify } from './resilientRequest';

/** The account's own mixes (ADR-0479, docs/engineering/engine-store-mixes.md): with
 * `cloud.account_mixes`, the shared shell's mix and draft calls are answered by the account's
 * Cloud routes, which are the Desktop's own (`GET /mix`, `POST /mix/songs`, `/drafts`...), so a
 * mix is the same on every device. Off, or on a server too old to name the flag (`flagListed`),
 * nothing here answers and the browser's saved mixes (recipes) answer as before.
 *
 * What is sent: catalogue song ids, positions, a draft's name and a transition's choice. Never
 * audio, a file, a path or a folder name. */

export const accountMixesOn = (): boolean => flagListed('cloud.brain') && flagListed('cloud.account_mixes');

/** The calls the account answers, by method and route (paths without /api). */
export const ACCOUNT_ROUTES: ReadonlyArray<[string, RegExp]> = [
  ['GET', /^\/mix$/],
  ['GET', /^\/drafts$/],
  ['GET', /^\/drafts\/names$/],
  ['POST', /^\/drafts$/],
  ['POST', /^\/drafts\/restore$/],
  ['POST', /^\/drafts\/\d+\/(name|duplicate|play)$/],
  ['DELETE', /^\/drafts\/\d+$/],
  ['POST', /^\/mix\/songs$/],
  ['DELETE', /^\/mix\/songs\/\d+$/],
  ['POST', /^\/mix\/move$/],
  ['PUT', /^\/mix\/order$/],
  ['POST', /^\/mix\/clear$/],
  ['POST', /^\/mix\/undo$/],
  ['POST', /^\/mix\/\d+\/(seam|lock)$/],
];

/** A failure that means the account can't answer right now (offline, a server fault, the
 * feature switched off for this account): the browser's own mixes answer instead. Any other
 * refusal (the mix changed, a draft gone, a song not in the library) is the account's answer. */
export function fallsBack(problem: unknown): boolean {
  if (canHeal(classify(problem))) return true;
  const coded = problem as { status?: number; code?: string };
  return coded.status === 403 && (coded.code === 'flag_off' || coded.code === 'plan_required');
}

export type AccountMixes = {
  /** The account's answer, or undefined when this call isn't one of its routes or it is off. */
  answer: (method: string, route: string, query: string, init?: RequestInit) => Promise<unknown> | undefined;
  /** A mix made on this device becomes the current mix, or a new draft when `asDraft`. */
  install: (name: string, songIds: number[], asDraft: boolean) => Promise<MixData | { id: number; name: string; count: number }>;
};

/** `cloud` asks the Cloud API with the account's token and workspace. */
export function accountMixes(cloud: Request): AccountMixes {
  return {
    answer: (method, route, query, init) => {
      if (!accountMixesOn() || !ACCOUNT_ROUTES.some(([verb, path]) => verb === method && path.test(route))) return undefined;
      return cloud(query ? `${route}?${query}` : route, init);
    },
    install: async (name, songIds, asDraft) => {
      const order = (path: string, body: object) => cloud<MixData>(path, { method: 'PUT', body: JSON.stringify(body) });
      if (!asDraft) return order('/mix/order', { song_ids: songIds, name });
      // the draft keeps the name it was made under (numbered when another has it)
      const made = await cloud<{ id: number; name: string }>('/drafts', { method: 'POST', body: JSON.stringify({ name }) });
      await order(`/mix/order?draft=${made.id}`, { song_ids: songIds });
      return { id: made.id, name: made.name, count: songIds.length };
    },
  };
}
