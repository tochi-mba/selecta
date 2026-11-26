import type { MediaResolver } from '../media';
import type { Api } from './api';

/** The hosted fallback for coexisting accounts (ADR-0465, BF-0465-03).
 *
 * A grandfathered account keeps its stored hosted media playable through the
 * `cloud.stored_media` routes: `GET /api/assets` lists it (with each file's sha256) and
 * `GET /api/assets/{id}/playback-url` signs a short-lived link to the original. A catalogue
 * song is matched to a hosted asset by content first (the device's own identity hash for the
 * song, when this device ever imported it), then by the exact "Artist - Title" or "Title" file
 * name, case and extension aside. Anything less certain is no match: playing the wrong song
 * would be worse than saying the song is unavailable.
 */

export type HostedAsset = { id: string; name: string; sha256?: string | null };
type Page = { assets: HostedAsset[]; next_cursor: string | null };

const PAGE = 100;
const MAX_PAGES = 200;

export type CatalogueEntry = { song_id: number; artist?: string | null; title?: string | null };

const plain = (text: string) => text.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The hosted asset that is this song, or null when no match is certain. */
export function matchAsset(song: CatalogueEntry, sha: string | null, assets: readonly HostedAsset[]): HostedAsset | null {
  if (sha) {
    const same = assets.find((asset) => asset.sha256 && asset.sha256.toLowerCase() === sha.toLowerCase());
    if (same) return same;
  }
  const title = plain(song.title ?? '');
  if (!title) return null;
  const names = new Set([title, song.artist ? plain(`${song.artist} - ${song.title}`) : title]);
  const named = assets.filter((asset) => names.has(plain(asset.name)));
  return named.length === 1 ? named[0] : null;
}

/** Every hosted asset, page by page by the server's cursor. */
export async function readHostedAssets(api: Api, workspaceId: string): Promise<HostedAsset[]> {
  const found: HostedAsset[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) query.set('cursor', cursor);
    const answer: Page = await api<Page>(`/assets?${query}`, {}, workspaceId);
    found.push(...answer.assets.map((asset) => ({ id: asset.id, name: asset.name, sha256: asset.sha256 ?? null })));
    if (!answer.next_cursor || seen.has(answer.next_cursor)) break;
    seen.add(answer.next_cursor);
    cursor = answer.next_cursor;
  }
  return found;
}

// One listing of the hosted copies per workspace, shared by the Library's "stored in Cloud" check
// and the player, read again when it is older than HOSTED_FRESH_MS or after an upload was
// accepted (`forgetHostedAssets`), so a new upload shows and plays without a reload.
export const HOSTED_FRESH_MS = 20_000;
/** Said on window when an upload was accepted or a stored song changed (CloudApp's event stream). */
export const LIBRARY_CHANGED_EVENT = 'selecta:library-changed';
const kept = new Map<string, { at: number; listing: Promise<HostedAsset[]> }>();

export function hostedAssets(api: Api, workspaceId: string, now = Date.now()): Promise<HostedAsset[]> {
  const known = kept.get(workspaceId);
  if (known && now - known.at < HOSTED_FRESH_MS) return known.listing;
  const listing = readHostedAssets(api, workspaceId).catch((problem) => { kept.delete(workspaceId); throw problem; });
  kept.set(workspaceId, { at: now, listing });
  return listing;
}

/** After an upload is accepted: the next look reads the hosted copies again. */
export function forgetHostedAssets(workspaceId?: string): void {
  if (workspaceId) kept.delete(workspaceId);
  else kept.clear();
}

/** A MediaResolver over the account's hosted copies. `songs` is the current programme's
 * catalogue entries; `shaOf` reads the device's identity hash for a song when it has one. */
export function hostedResolver(api: Api, workspaceId: string, options: {
  songs: () => readonly CatalogueEntry[];
  shaOf?: (songId: number) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}): MediaResolver {
  const assets = () => hostedAssets(api, workspaceId);
  const fetchBytes = options.fetchBytes ?? (async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('SelectaDJ could not fetch this song from your cloud library.');
    return response.arrayBuffer();
  });
  return async (songId) => {
    const song = options.songs().find((entry) => entry.song_id === songId);
    if (!song) return null;
    const sha = (await options.shaOf?.(songId).catch(() => null)) ?? null;
    let asset = matchAsset(song, sha, await assets());
    if (!asset) {
      // a song uploaded since the listing was read: look once more before saying it is not here
      forgetHostedAssets(workspaceId);
      asset = matchAsset(song, sha, await assets());
    }
    if (!asset) return null;
    return {
      id: songId,
      source: 'hosted',
      // the link is signed when the engine wants the bytes, so it never expires in a queue
      data: async () => {
        const signed = await api<{ url: string }>(`/assets/${encodeURIComponent(asset.id)}/playback-url`, {}, workspaceId);
        return fetchBytes(signed.url);
      },
    };
  };
}
