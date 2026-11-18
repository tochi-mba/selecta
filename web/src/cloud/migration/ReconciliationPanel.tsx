import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton, Status } from '../../ui/controls';
import { Truncate } from '../../ui/format';
import { navigate } from '../../router';
import { EmptyState } from '../LocalFirstEmpty';

/** The migration reconciliation (ADR-0465 BF-0465-02): the member's hosted uploads side by side
 * with the songs added on their devices, matched by content hash and nothing else (ADR-0458:
 * identity is the hash or nothing; title and artist never merge two songs).
 *
 * It only reads. It sends GET requests and nothing else: no deletion, no upload, no write of any
 * kind. A hosted original stays in hosted storage whatever the report says. */

/** The workspace-authenticated Cloud client: it adds `/api`, the token and the workspace, so the
 * paths below start at the route (`/assets`, `/local-media/songs`). */
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export type HostedAsset = { id: string; name: string; sha256: string | null; size?: number };
export type LocalSong = { id: number; content_sha256: string; title: string; artist: string; duplicate_of?: number | null };

export type ReconciledRow =
  | { kind: 'matched'; asset: HostedAsset; song: LocalSong; reason: string }
  | { kind: 'hosted_only'; asset: HostedAsset; reason: string }
  | { kind: 'device_only'; song: LocalSong; reason: string };

/** Safety stop for a runaway cursor: 100 pages of 100 is 10,000 items each side. */
const MAX_PAGES = 100;
const PAGE = 100;

const REASONS = {
  matched: 'The same audio is on your device, matched by its contents. Mixes that use it can play it from there.',
  noFingerprint: 'SelectaDJ has no fingerprint for this upload, so it can’t be matched. It stays in your hosted library and plays from there.',
  notOnDevice: 'Not on a device yet. It stays in your hosted library and plays from there.',
  differentAudio: 'A song with a similar name is on your device, but its audio is different (perhaps another encoding), so the two are kept apart. Each mix keeps using the one it already uses.',
  deviceOnly: 'Added on a device, with no hosted copy. That’s fine: it plays from the device.',
};

const normal = (text: string) => text.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Match hosted assets to local songs by content hash. Pure, so it can be tested on its own. */
export function reconcile(assets: HostedAsset[], songs: LocalSong[]): ReconciledRow[] {
  const byHash = new Map<string, LocalSong>();
  for (const song of songs) {
    const hash = song.content_sha256.toLowerCase();
    if (!byHash.has(hash)) byHash.set(hash, song);
  }
  const used = new Set<number>();
  const rows: ReconciledRow[] = [];
  for (const asset of assets) {
    const song = asset.sha256 ? byHash.get(asset.sha256.toLowerCase()) : undefined;
    if (song) {
      used.add(song.id);
      rows.push({ kind: 'matched', asset, song, reason: REASONS.matched });
      continue;
    }
    if (!asset.sha256) {
      rows.push({ kind: 'hosted_only', asset, reason: REASONS.noFingerprint });
      continue;
    }
    // A name hint only explains; it never matches.
    const name = normal(asset.name);
    const lookalike = name.length >= 3 && songs.some((candidate) => {
      const title = normal(candidate.title);
      return title.length >= 3 && name.includes(title);
    });
    rows.push({ kind: 'hosted_only', asset, reason: lookalike ? REASONS.differentAudio : REASONS.notOnDevice });
  }
  for (const song of songs) {
    if (!used.has(song.id)) rows.push({ kind: 'device_only', song, reason: REASONS.deviceOnly });
  }
  return rows;
}

type PageResult<T> = { items: T[]; truncated: boolean };

async function allAssets(request: Request): Promise<PageResult<HostedAsset>> {
  const found: HostedAsset[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = cursor ? `?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}` : `?limit=${PAGE}`;
    const answer: { assets: HostedAsset[]; next_cursor?: string | null } = await request(`/assets${query}`, { method: 'GET' });
    found.push(...answer.assets);
    cursor = answer.next_cursor ?? null;
    if (!cursor) break;
  }
  return { items: found, truncated: cursor !== null };
}

async function allSongs(request: Request): Promise<PageResult<LocalSong>> {
  const found: LocalSong[] = [];
  let after: number | undefined;
  let hasMore = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = after !== undefined ? `?limit=${PAGE}&after=${after}` : `?limit=${PAGE}`;
    const answer: { songs: LocalSong[]; next?: number } = await request(`/local-media/songs${query}`, { method: 'GET' });
    found.push(...answer.songs);
    if (answer.next === undefined || answer.next === null) {
      hasMore = false;
      break;
    }
    after = answer.next;
    hasMore = true;
  }
  return { items: found, truncated: hasMore };
}

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; rows: ReconciledRow[]; truncated: boolean };

export function ReconciliationPanel({ request }: { request: Request }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const current = useRef(0);
  const load = useCallback(() => {
    const run = ++current.current;
    setLoaded({ state: 'loading' });
    Promise.all([allAssets(request), allSongs(request)]).then(([assets, songs]) => {
      if (run === current.current) setLoaded({
        state: 'ready',
        rows: reconcile(assets.items, songs.items),
        truncated: assets.truncated || songs.truncated,
      });
    }, () => {
      if (run === current.current) setLoaded({ state: 'failed' });
    });
  }, [request]);
  useEffect(() => {
    load();
    return () => { current.current += 1; };
  }, [load]);

  return (
    <section className="cloud-card cloud-reconcile" aria-labelledby="cloud-reconcile-title">
      <p className="cloud-eyebrow">YOUR HOSTED AND DEVICE MUSIC</p>
      <h2 id="cloud-reconcile-title">How your libraries line up</h2>
      <p>SelectaDJ compares the audio itself, not the names. This only looks: it never deletes, moves or copies anything, and your hosted library stays as it is.</p>
      <div className="cloud-reconcile-next-steps">
        <p>To bring hosted music onto this device, download your hosted archive below, then choose the extracted original files here. SelectaDJ checks their contents in this browser; it never transfers audio between Cloud and this device.</p>
        <div className="cloud-actions">
          <a href="#cloud-data-title">Go to your account export</a>
          <button type="button" onClick={() => navigate('/library')}>Add music from this device</button>
        </div>
        <p className="cloud-hint">After adding music, return here and choose Check again. A match is based on identical audio bytes; a different encoding remains a separate recording.</p>
      </div>
      {loaded.state === 'loading' && <Skeleton variant="rows" lines={3} label="Comparing your libraries" />}
      {loaded.state === 'failed' && (
        <div role="alert">
          <p>SelectaDJ couldn’t load both libraries just now. Nothing was changed.</p>
          <button type="button" onClick={load}>Try again</button>
        </div>
      )}
      {loaded.state === 'ready' && <Report rows={loaded.rows} truncated={loaded.truncated} onRefresh={load} />}
    </section>
  );
}

function Report({ rows, truncated, onRefresh }: { rows: ReconciledRow[]; truncated: boolean; onRefresh: () => void }) {
  const matched = rows.filter((row) => row.kind === 'matched');
  const hosted = rows.filter((row) => row.kind === 'hosted_only');
  const device = rows.filter((row) => row.kind === 'device_only');
  if (!rows.length) {
    return (
      <>
        {truncated && <p role="status">This report reached the 10,000-item safety limit. It may not include every item; narrow your library or ask support for a full reconciliation.</p>}
        <EmptyState title="Nothing to compare yet" actions={<button type="button" onClick={onRefresh}>Check again</button>}>
          There’s nothing to compare yet: no hosted uploads and no songs added on a device.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {truncated && <p role="status">This report reached the 10,000-item safety limit. It may not include every item; narrow your library or ask support for a full reconciliation.</p>}
      <p role="status">{matched.length} matched · {hosted.length} only in your hosted library · {device.length} only on your devices</p>
      {!!matched.length && (
        <Group title="Matched" rows={matched} />
      )}
      {!!hosted.length && <Group title="Only in your hosted library" rows={hosted} />}
      {!!device.length && <Group title="Only on your devices" rows={device} />}
      <button type="button" onClick={onRefresh}>Check again</button>
    </>
  );
}

function Group({ title, rows }: { title: string; rows: ReconciledRow[] }) {
  return (
    <section className="cloud-reconcile-group" aria-label={title}>
      <h3>{title}</h3>
      <ul className="cloud-reconcile-list">
        {rows.map((row) => {
          const key = row.kind === 'device_only' ? `song-${row.song.id}` : `asset-${row.asset.id}`;
          const name = row.kind === 'device_only' ? `${row.song.title} · ${row.song.artist}` : row.asset.name;
          return (
            <li key={key}>
              <Truncate className="cloud-reconcile-name" text={name} />
              {row.kind === 'matched' && <Status kind="ready">Matched</Status>}
              {row.kind === 'hosted_only' && <Status kind="unavailable">Hosted only</Status>}
              {row.kind === 'device_only' && <Status kind="planned">On your device</Status>}
              <small>{row.kind === 'matched' ? `${row.reason} On your device as ${row.song.title} · ${row.song.artist}.` : row.reason}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
