import { ApiError, type MixData, type Request } from '../api';
import { flagListed } from '../flags';
import { oneMixerOn } from './musicHomes';
import type { CatalogueSong } from './deviceMusicRequest';
import type { ExportState } from './hosted/hostedWords';

/** "Make the file in your cloud library" (cloud.one_mixer). When every song of a mix is in the
 * cloud library, its file can be made there rather than on this device: the export the cloud
 * studio makes (`POST /api/hosted/mixes/export`, with the songs named by catalogue id, each played
 * from its cloud copy). The requests carry catalogue song ids and an export's id, nothing more: no
 * audio, no file name, no path (cloudLibrary.egress.test.ts).
 *
 * The shared Export panel asks the adapter, with `?draft=` for a draft:
 * - `GET /exports/cloud`: `{ offered }`, true when every song has its own cloud copy;
 * - `POST /exports/cloud`: asks for the file, the server's answer (asking again while its parts
 *   are being made moves them along, as playing it would);
 * - `GET /exports/cloud/{job}`: how far the file has got. */

/** With `cloud.one_mixer` (or the cloud-only shell, musicHomes.ts) and the cloud studio named on. */
export const cloudFileOn = (): boolean => oneMixerOn() && flagListed('cloud.hosted_render');

/** The server's answer: an export's state, or `preparing` with the mix's counts. */
export type CloudFileState = ExportState & {
  counts?: { seams_ready: number; seams_failed?: number; seams: number; files_ready: number; songs: number };
  missing?: number[];
};

export const NOT_IN_CLOUD = (title: string) => `${title} isn’t in your cloud library, so the file can’t be made there.`;

const refuse = (message: string, code: string, status = 409) => new ApiError(message, status, code, 'device-music:export-cloud');
const JOB = /^\/exports\/cloud\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/;

/** Of these song ids, those whose OWN catalogue row has a cloud copy: the rule the server's export
 * uses (`cloud_copies`: the row's own hash and its other known hashes), never a row's union of
 * versions and never a name. The server's own answer for the row when it gives one; else
 * `cloudCopy` for that row alone (an upload with its own hash); else none, so nothing is offered
 * that the server could refuse. */
export async function ownCloudCopies(
  files: readonly CatalogueSong[],
  songIds: readonly number[],
  cloudCopy?: (rows: readonly CatalogueSong[], all: readonly CatalogueSong[]) => Promise<string | null>,
): Promise<ReadonlySet<number>> {
  const rows = new Map(files.map((file) => [file.id, file]));
  const server = files.some((file) => file.cloud !== undefined);
  const found = new Set<number>();
  for (const id of new Set(songIds)) {
    const row = rows.get(id);
    if (!row) continue;
    const own = server ? !!row.cloud?.asset_id : !!(await cloudCopy?.([row], files).catch(() => null));
    if (own) found.add(id);
  }
  return found;
}

export function cloudFileFamily(deps: {
  /** The account's API (paths without /api). */
  cloud: Request;
  /** The mix being saved: the current one, or the draft. */
  mix: (draft: number | null) => Promise<MixData>;
  /** Of these song ids, those with their own cloud copy (`ownCloudCopies`). */
  inCloud: (songIds: readonly number[]) => Promise<ReadonlySet<number>>;
}) {
  const away = async (mix: MixData) => {
    const have = await deps.inCloud(mix.mix.map((item) => item.song_id)).catch(() => new Set<number>());
    return mix.mix.find((item) => !have.has(item.song_id)) ?? null;
  };
  return {
    answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit): Promise<unknown> | undefined => {
      if (route !== '/exports/cloud' && !route.startsWith('/exports/cloud/')) return undefined;
      if (!cloudFileOn()) return Promise.reject(refuse('Making the file in your cloud library is switched off for this account.', 'flag_off', 403));
      const draft = query.get('draft') ? Number(query.get('draft')) : null;
      if (method === 'GET' && route === '/exports/cloud') {
        return (async () => {
          const mix = await deps.mix(draft);
          return { offered: mix.mix.length >= 2 && !(await away(mix)) };
        })();
      }
      if (method === 'POST' && route === '/exports/cloud') {
        return (async () => {
          const mix = await deps.mix(draft);
          let expected: string | null = null;
          try { expected = new Headers(init?.headers).get('x-mix-order'); } catch { /* no guard */ }
          if (expected !== null && expected !== mix.mix.map((item) => item.song_id).join(',')) throw refuse('The mix changed. Look at it again, then make the file.', 'mix_changed');
          if (mix.mix.length < 2) throw refuse('A mix needs at least two songs to make a file.', 'too_short', 400);
          const missing = await away(mix);
          if (missing) throw refuse(NOT_IN_CLOUD(missing.title || 'A song'), 'not_in_cloud');
          return deps.cloud<CloudFileState>('/hosted/mixes/export', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ songs: mix.mix.map((item) => ({ song_id: item.song_id })) }),
          });
        })();
      }
      const one = JOB.exec(route);
      if (method === 'GET' && one) return deps.cloud<CloudFileState>(`/hosted/exports/${encodeURIComponent(one[1])}`);
      return Promise.reject(refuse('That isn’t something this does.', 'not_found', 404));
    },
  };
}
