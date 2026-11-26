import type { MixData, Request } from '../api';
import { flagListed } from '../flags';
import { deviceId } from './currentMix';
import { canHeal, classify } from './resilientRequest';

/** The account's own mixes (ADR-0479, docs/engineering/engine-store-mixes.md): with
 * `cloud.account_mixes`, the shared shell's mix and draft calls are answered by the account's
 * Cloud routes, which are the Desktop's own (`GET /mix`, `POST /mix/songs`, `/drafts`...), so a
 * mix is the same on every device. Off, or on a server too old to name the flag (`flagListed`),
 * nothing here answers and the browser's saved mixes (recipes) answer as before.
 *
 * What is sent: catalogue song ids, positions, a draft's name and a transition's choice, and on a
 * change of which mix is current, this device's id, so the others are told which one changed it.
 * Never audio, a file, a path or a folder name. */

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

/** The calls that change which mix is current: each names this device (`device_id`), so the
 * account's `mix.current` event says which device it was. A draft's own order is not one. */
const CHANGES_CURRENT: ReadonlyArray<[string, RegExp]> = [
  ['PUT', /^\/mix\/order$/],
  ['POST', /^\/drafts\/\d+\/play$/],
  ['POST', /^\/mix\/undo$/],
  ['POST', /^\/mix\/clear$/],
];

function withDevice(method: string, route: string, query: string, workspaceId: string | undefined): string {
  const device = workspaceId ? deviceId(workspaceId) : null;
  const search = new URLSearchParams(query);
  if (!device || search.has('draft') || !CHANGES_CURRENT.some(([verb, path]) => verb === method && path.test(route))) return query;
  search.set('device_id', device);
  return search.toString();
}

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

/** `cloud` asks the Cloud API with the account's token and workspace; `workspaceId` finds this
 * device's id. */
export function accountMixes(cloud: Request, workspaceId?: string): AccountMixes {
  return {
    answer: (method, route, query, init) => {
      if (!accountMixesOn() || !ACCOUNT_ROUTES.some(([verb, path]) => verb === method && path.test(route))) return undefined;
      const asked = withDevice(method, route, query, workspaceId);
      return cloud(asked ? `${route}?${asked}` : route, init);
    },
    install: async (name, songIds, asDraft) => {
      const order = (path: string, body: object) => cloud<MixData>(path, { method: 'PUT', body: JSON.stringify(body) });
      if (!asDraft) {
        const asked = withDevice('PUT', '/mix/order', '', workspaceId);
        return order(asked ? `/mix/order?${asked}` : '/mix/order', { song_ids: songIds, name });
      }
      // the draft keeps the name it was made under (numbered when another has it)
      const made = await cloud<{ id: number; name: string }>('/drafts', { method: 'POST', body: JSON.stringify({ name }) });
      await order(`/mix/order?draft=${made.id}`, { song_ids: songIds });
      return { id: made.id, name: made.name, count: songIds.length };
    },
  };
}
