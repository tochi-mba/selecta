import type { Request } from '../api';
import { accountMixesOn } from './accountMixes';

/** The member's own song requests kept with the account (ADR-0479,
 * docs/engineering/engine-store-requests.md): with `cloud.brain` and `cloud.account_mixes`, a
 * song the member asks for is saved by the account's request routes, the Desktop's own
 * (`GET /requests`, `POST /requests`, `DELETE /requests/{id}`), so it waits on every device they
 * use. Off, or on a server too old to name the flags, nothing here is asked and the browser keeps
 * its requests itself, as before (localFirstRequests.ts).
 *
 * What is sent: a catalogue song id, and a request's id to let it go. Never audio, a file, a path
 * or a folder name. */

export const accountRequestsOn = accountMixesOn;

/** A waiting request as the account's `GET /requests` lists it (the fields used here). */
export type AccountRequest = { id: number; song_id: number; available: number };

export type AccountRequests = {
  /** Every waiting request of the account, oldest first. */
  list: () => Promise<AccountRequest[]>;
  /** Ask for a song; asking again for a waiting one changes nothing. */
  ask: (songId: number) => Promise<void>;
  /** Let a request go: it was played, or the member dismissed it. */
  letGo: (requestId: number) => Promise<void>;
};

/** `cloud` asks the Cloud API with the account's token and workspace. */
export function accountRequests(cloud: Request): AccountRequests {
  return {
    list: async () => (await cloud<{ requests: AccountRequest[] }>('/requests')).requests ?? [],
    ask: async (songId) => {
      await cloud('/requests', { method: 'POST', body: JSON.stringify({ song_id: songId }) });
    },
    letGo: async (requestId) => {
      await cloud(`/requests/${requestId}`, { method: 'DELETE' });
    },
  };
}
