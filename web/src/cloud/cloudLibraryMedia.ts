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
 *
 * With cloud.catalogue_play a song's upload is found from the catalogue instead (`catalogueCopy`):
 * the server's answer for the song, else an upload with one of its files' hashes. Name matching
 * stays only for when that flag is off.
 */

export type CloudLibraryAsset = { id: string; name: string; sha256?: string | null };
type Page = { assets: CloudLibraryAsset[]; next_cursor: string | null };

const PAGE = 100;
const MAX_PAGES = 200;

export type CatalogueEntry = { song_id: number; artist?: string | null; title?: string | null };

const plain = (text: string) => text.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The hosted asset that is this song, or null when no match is certain. */
export function matchAsset(song: CatalogueEntry, sha: string | null, assets: readonly CloudLibraryAsset[]): CloudLibraryAsset | null {
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
export async function readCloudLibraryAssets(api: Api, workspaceId: string): Promise<CloudLibraryAsset[]> {
  const found: CloudLibraryAsset[] = [];
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
// accepted (`forgetCloudLibraryAssets`), so a new upload shows and plays without a reload.
export const HOSTED_FRESH_MS = 20_000;
/** Said on window when an upload was accepted or a stored song changed (CloudApp's event stream). */
export const LIBRARY_CHANGED_EVENT = 'selecta:library-changed';
const kept = new Map<string, { at: number; listing: Promise<CloudLibraryAsset[]> }>();

export function cloudLibraryAssets(api: Api, workspaceId: string, now = Date.now()): Promise<CloudLibraryAsset[]> {
  const known = kept.get(workspaceId);
  if (known && now - known.at < HOSTED_FRESH_MS) return known.listing;
  const listing = readCloudLibraryAssets(api, workspaceId).catch((problem) => { kept.delete(workspaceId); throw problem; });
  kept.set(workspaceId, { at: now, listing });
  return listing;
}

/** After an upload is accepted: the next look reads the hosted copies again. */
export function forgetCloudLibraryAssets(workspaceId?: string): void {
  if (workspaceId) kept.delete(workspaceId);
  else kept.clear();
}

/** A catalogue file as the copy lookup reads it: its own hash, and the server's answer for its
 * copy in the cloud library when the server sends one (`cloud`, null when it has none). */
export type CatalogueFile = { id: number; content_sha256?: string | null; cloud?: { asset_id: string } | null };

/** Whether the server says each file's cloud copy itself, so the uploads need not be listed. */
export const serverSaysCopies = (files: readonly CatalogueFile[]): boolean => files.some((file) => file.cloud !== undefined);

/** cloud.catalogue_play: the upload that is this song, from its catalogue rows (best version
 * first): the server's own answer for any of them, else an upload with one of their hashes.
 * Never by name, and never through this device's own files. `assets` is null when the server
 * says the copies itself. */
export function catalogueCopy(rows: readonly CatalogueFile[], assets: readonly CloudLibraryAsset[] | null): string | null {
  for (const row of rows) if (row.cloud?.asset_id) return row.cloud.asset_id;
  if (!assets) return null;
  for (const row of rows) {
    const sha = row.content_sha256?.toLowerCase();
    const same = sha ? assets.find((asset) => asset.sha256?.toLowerCase() === sha) : undefined;
    if (same) return same.id;
  }
  return null;
}

/** The catalogue files with a copy in the cloud library, by the same rule as `catalogueCopy`. */
export async function catalogueHeld(api: Api, workspaceId: string, files: readonly CatalogueFile[]): Promise<Set<number>> {
  const assets = serverSaysCopies(files) ? null : await cloudLibraryAssets(api, workspaceId);
  return new Set(files.filter((file) => catalogueCopy([file], assets)).map((file) => file.id));
}

// A signed link lives for `expires_in` seconds (300 unless asked otherwise, at most 15 minutes:
// storage/playback_api.py). It is kept while good and signed again a little before it runs out.
const SIGNED_FOR_S = 300;
const SIGN_AGAIN_BEFORE_MS = 30_000;

/** Signed links to the account's uploads, kept while good and signed again on demand. */
export function signedLinks(api: Api, workspaceId: string, now: () => number = Date.now) {
  const kept = new Map<string, { url: string; until: number }>();
  return async (assetId: string, again = false): Promise<string> => {
    const known = kept.get(assetId);
    if (!again && known && known.until > now()) return known.url;
    const signed = await api<{ url: string; expires_in?: number }>(`/assets/${encodeURIComponent(assetId)}/playback-url`, {}, workspaceId);
    kept.set(assetId, { url: signed.url, until: now() + (signed.expires_in ?? SIGNED_FOR_S) * 1000 - SIGN_AGAIN_BEFORE_MS });
    return signed.url;
  };
}

/** A storage answer that may mean the link ran out (R2 answers 403 to an expired link). */
const mayHaveRunOut = (problem: unknown) => [400, 401, 403].includes(Number((problem as { status?: unknown } | null)?.status));

/** A MediaResolver over the account's hosted copies. `songs` is the current programme's
 * catalogue entries; `shaOf` reads the device's identity hash for a song when it has one.
 * With `assetOf` (cloud.catalogue_play) a song is found by its catalogue id alone, so a song
 * outside the programme, on a device that never held it, still plays. */
export function cloudLibraryResolver(api: Api, workspaceId: string, options: {
  songs: () => readonly CatalogueEntry[];
  shaOf?: (songId: number) => Promise<string | null>;
  assetOf?: (songId: number) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  now?: () => number;
}): MediaResolver {
  const assets = () => cloudLibraryAssets(api, workspaceId);
  const fetchBytes = options.fetchBytes ?? (async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error('SelectaDJ could not fetch this song from your cloud library.'), { status: response.status });
    return response.arrayBuffer();
  });
  const assetOf = options.assetOf;
  if (assetOf) {
    const link = signedLinks(api, workspaceId, options.now);
    return async (songId) => {
      let assetId = await assetOf(songId);
      if (!assetId) {
        // uploaded since the uploads were last read: look once more before saying it is not here
        forgetCloudLibraryAssets(workspaceId);
        assetId = await assetOf(songId);
      }
      if (!assetId) return null;
      const id = assetId;
      return {
        id: songId,
        source: 'hosted',
        // signed when the engine wants the bytes, and again when the link ran out meanwhile
        // (a long pause, a seek, a song that starts after its link expired)
        data: async () => {
          try {
            return await fetchBytes(await link(id));
          } catch (problem) {
            if (!mayHaveRunOut(problem)) throw problem;
            return fetchBytes(await link(id, true));
          }
        },
      };
    };
  }
  return async (songId) => {
    const song = options.songs().find((entry) => entry.song_id === songId);
    if (!song) return null;
    const sha = (await options.shaOf?.(songId).catch(() => null)) ?? null;
    let asset = matchAsset(song, sha, await assets());
    if (!asset) {
      // a song uploaded since the listing was read: look once more before saying it is not here
      forgetCloudLibraryAssets(workspaceId);
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
