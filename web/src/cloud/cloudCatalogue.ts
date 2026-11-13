import type { Api } from './api';

// The Cloud library as Listen and the playback session see it (AV-0419-04).
//
// The playback session stores a song as a position, `song_index`. Before this catalogue, Cloud
// Listen read one page of `/assets?limit=200` and used positions into it, which had two faults:
// the server serves at most 100 per page (so the read was refused outright), and a library
// longer than one page could never be reached. The catalogue instead walks every page by the
// server's cursor, keeps each song by its stable asset id, and orders the whole library oldest
// first. Oldest first is append-only: a new upload lands at the end and never moves a song
// that is already playing. Once a position has been played here it stays pinned to that asset
// id, so a library refresh mid-set can't swap the song under the listener.

export type CatalogueAsset = { id: string; name: string };
type AssetPage = { assets: CatalogueAsset[]; next_cursor: string | null };

/** The server's largest page (`_MAX_PAGE_SIZE` in src/selecta/routes/cloud_assets.py). */
export const CATALOGUE_PAGE_SIZE = 100;

export type AssetCatalogue = {
  /** Every song, oldest first, reading every page the first time it is needed. */
  list: () => Promise<CatalogueAsset[]>;
  /** The stable asset id at a session position, or null past the end. */
  idAt: (index: number) => Promise<string | null>;
  /** The position of an asset id, or -1 when it isn't in the library. */
  indexOf: (id: string) => Promise<number>;
  /** The name of the song at a position, once the catalogue has been read. */
  name: (index: number) => string | null;
  /** Forget the read list (the library changed); pinned positions keep their asset id. */
  refresh: () => void;
};

export function assetCatalogue(api: Api, workspaceId: string): AssetCatalogue {
  let loaded: Promise<CatalogueAsset[]> | null = null;
  let known: CatalogueAsset[] | null = null;
  const pinned = new Map<number, CatalogueAsset>();

  const readAll = async () => {
    const newestFirst: CatalogueAsset[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: String(CATALOGUE_PAGE_SIZE) });
      if (cursor) query.set('cursor', cursor);
      const page: AssetPage = await api<AssetPage>(`/assets?${query}`, {}, workspaceId);
      for (const asset of page.assets) newestFirst.push({ id: asset.id, name: asset.name });
      // A server that hands the same cursor back would loop for ever; stop instead.
      if (page.next_cursor && seen.has(page.next_cursor)) break;
      if (page.next_cursor) seen.add(page.next_cursor);
      cursor = page.next_cursor;
    } while (cursor);
    known = newestFirst.reverse();
    return known;
  };

  const list = () => {
    if (!loaded) loaded = readAll().catch((problem) => { loaded = null; throw problem; });
    return loaded;
  };

  const at = async (index: number) => {
    if (index < 0) return null;
    const held = pinned.get(index);
    if (held) return held;
    const asset = (await list())[index] ?? null;
    if (asset) pinned.set(index, asset);
    return asset;
  };

  return {
    list,
    idAt: async (index) => (await at(index))?.id ?? null,
    indexOf: async (id) => (await list()).findIndex((asset) => asset.id === id),
    name: (index) => pinned.get(index)?.name ?? known?.[index]?.name ?? null,
    refresh: () => { loaded = null; },
  };
}

type Proxy = { status: string; url?: string };
const GIVE_UP = ['failed', 'cancelled', 'quarantined', 'not_requested'];

/** A ready playback URL for one asset id, preparing it first, or null if it can't be prepared. */
export async function playbackUrl(api: Api, workspaceId: string, assetId: string, pollMs = 1500, tries = 200): Promise<string | null> {
  const path = `/assets/${encodeURIComponent(assetId)}/playback-proxy`;
  let result = await api<Proxy>(path, { method: 'POST' }, workspaceId);
  for (let attempt = 0; result.status !== 'ready' && attempt < tries; attempt++) {
    if (GIVE_UP.includes(result.status)) return null;
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    result = await api<Proxy>(path, {}, workspaceId);
  }
  return result.status === 'ready' ? result.url ?? null : null;
}

/** The session's song source for a speaker: position, to stable asset id, to playback URL. */
export function catalogueSource(api: Api, workspaceId: string, catalogue = assetCatalogue(api, workspaceId)) {
  const source = async (index: number): Promise<string | null> => {
    const id = await catalogue.idAt(index);
    return id ? playbackUrl(api, workspaceId, id) : null;
  };
  return { source, name: catalogue.name, catalogue };
}
