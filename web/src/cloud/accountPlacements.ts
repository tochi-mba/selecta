import type { MixData, Request } from '../api';
import { accountRequestsOn } from './accountRequests';
import { reportingOn, thisDevice } from './seamReports';
import { prepareRequestSeams } from './studioWiring';

/** Where the account would put a waiting request, and its transitions made on this device
 * (T-20261126-a246; docs/engineering/engine-store-requests.md "What ready means in Cloud").
 *
 * With `cloud.brain`, `cloud.account_mixes` and `cloud.device_render`, the request look goes to
 * the account (`POST /requests/consider?device_id=`), which plans each waiting request's place
 * from the measured songs and lists the transitions it needs. This device's studio makes those
 * ahead, after the mix's own, and reports each one (seamReports.ts). Once every one is reported
 * the account calls the placement ready for this device, and `POST /requests/insert` puts it in
 * as one change. Off, without a registered device, or on any failure, nothing here answers and
 * the member adds a request by hand, as before.
 *
 * What is sent: the mix's song ids, the playing position and how long the song has left, an
 * offer's name and this device's id. Never audio, a file, a path or a folder name. */

export const placingOn = (): boolean => accountRequestsOn() && reportingOn();

/** The playback the account's look checks against its own mix (`RequestPlayback`). */
export type Playback = { order: number[]; position: number; phase: string; seconds_left: number };

/** A waiting request as the account's look answers it (the fields used here). */
export type Placement = {
  id: number;
  song_id: number;
  stage?: string;
  ready?: boolean;
  offer?: string;
  needs_approval?: boolean;
  after?: string;
  seams_needed?: { a: number; b: number }[];
};

export type Look = { requests: Placement[]; settled: string[] };

/** An offer from the account, told apart from this browser's own (`request-<n>`). */
export const ACCOUNT_OFFER = 'account-';

function playbackOf(body: Partial<Playback>): Playback | null {
  const { order, position, phase, seconds_left: left } = body;
  if (!Array.isArray(order) || !order.every(Number.isInteger) || !Number.isInteger(position)) return null;
  if (phase !== 'playing' && phase !== 'paused') return null;
  if (typeof left !== 'number' || !Number.isFinite(left)) return null;
  return { order, position: Number(position), phase, seconds_left: left };
}

export type AccountPlacements = {
  /** The account's look for this playback, with each placement's transitions asked of this
   * device's studio; null when it is off or can't be had. */
  look: (body: Partial<Playback>) => Promise<Look | null>;
  /** Put a ready placement in, against the exact mix it was planned for. */
  insert: (body: Partial<Playback>, offer: string) => Promise<MixData>;
};

export function accountPlacements(cloud: Request, workspaceId: string): AccountPlacements {
  const device = () => (placingOn() ? thisDevice(workspaceId) : null);
  const post = <T,>(path: string, body: unknown) => cloud<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    look: async (body) => {
      const id = device();
      const playback = playbackOf(body);
      if (!id || !playback) return null;
      try {
        const answer = await post<Partial<Look>>(`/requests/consider?device_id=${encodeURIComponent(id)}`, playback);
        const requests = Array.isArray(answer.requests) ? answer.requests : [];
        // the transitions of every placement still being made, the first placements first
        const pairs = requests
          .filter((row) => row.stage === 'preparing' && !row.ready)
          .flatMap((row) => (row.seams_needed ?? []).map(({ a, b }) => ({ a, b })));
        void prepareRequestSeams(workspaceId, pairs).catch(() => 0);
        return { requests, settled: Array.isArray(answer.settled) ? answer.settled : [] };
      } catch {
        return null;
      }
    },
    insert: async (body, offer) => {
      const id = device();
      const playback = playbackOf(body);
      if (!id || !playback) throw new Error('The mix changed. Reconsidering requests.');
      return post<MixData>(`/requests/insert?device_id=${encodeURIComponent(id)}`, { ...playback, offer });
    },
  };
}
