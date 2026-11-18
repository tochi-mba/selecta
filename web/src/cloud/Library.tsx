// Hosted mode only (ADR-0462): local-first accounts get the shared views and shell player instead.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useFlag } from '../flags';
import { Skeleton } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, Truncate } from '../ui/format';
import { EmptyState } from './LocalFirstEmpty';
import { Account, Api, Asset, bytes, Page } from './api';
import { INITIAL_LIBRARY, isBusy, libraryReducer, overviewOf, songWords } from './libraryState';
import { unfinishedUploads } from './uploadParts';
import { useSharedLibraryPlayer } from './cloudTransport';
import { useCloudPlayer } from './useCloudPlayer';

// The Cloud library: private originals, played from prepared playback files. Listening starts a
// run from that song to the end of the list, with the next song buffered ahead (see
// useCloudPlayer). Removing songs is how an over-quota account makes room, so it stays available.
//
// `truthful` (`cloud.library_states`, ADR-0421): loading, failed, empty and ready are told apart
// (libraryState.ts), so a list that didn't load never says "Your library is empty", and an
// overview above the list counts the songs, the storage they use and unfinished uploads.

/** How long a removed song waits before the server is told: the Undo toast's own 15 seconds. */
export const UNDO_WINDOW_MS = 15000;

function insertAt(list: Asset[], asset: Asset, at: number): Asset[] {
  const next = list.slice();
  next.splice(Math.min(at, next.length), 0, asset);
  return next;
}

export function LibraryPanel({ api, workspaceId, setError, refreshAccount, go, reload, truthful = true, account }: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  refreshAccount: () => Promise<void>;
  go: (page: Page) => void;
  /** Bumped when the server says the library changed, so the list reads again. */
  reload?: number;
  /** Tell loading, failed, empty and ready apart, with the overview (`cloud.library_states`). */
  truthful?: boolean;
  /** For the overview's storage figure. */
  account?: Account | null;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const [state, dispatch] = useReducer(libraryReducer, INITIAL_LIBRARY);
  const [unfinished, setUnfinished] = useState<number | null>(null);
  // songs removed inside their Undo window: off the list here, not yet deleted on the server
  const pending = useRef(new Map<string, { asset: Asset; at: number; timer: number }>());
  // Uploading needs `cloud.uploads` (and through it the hosted media grant, ADR-0456): with it
  // off, every way to the upload page and the unfinished-uploads read are gone, the list stays.
  const uploads = useFlag('cloud.uploads');
  const audioRef = useRef<HTMLAudioElement>(null);
  const own = useCloudPlayer({ api, workspaceId, audio: audioRef, setError });
  // One Cloud player (ADR-0419): with the dock mounted, songs play there and keep playing
  // across pages; without it (flag off) this page plays them itself, as before.
  const shared = useSharedLibraryPlayer(workspaceId);
  const player = shared ?? own;

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true); setError(''); dispatch({ type: 'request' });
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const answer = await api<{ assets: Asset[]; next_cursor: string | null }>(`/assets?${query}`, {}, workspaceId);
      const page = { ...answer, assets: answer.assets.filter((asset) => !pending.current.has(asset.id)) };
      setAssets((old) => append ? [...old, ...page.assets] : page.assets);
      setNextCursor(page.next_cursor);
      dispatch({ type: 'loaded', assets: page.assets, nextCursor: page.next_cursor, append });
    } catch (problem) {
      // Truthful: the failure is said where the list would be, not over an "empty" library.
      if (!truthful) setError((problem as Error).message);
      dispatch({ type: 'failed', message: (problem as Error).message });
    } finally { setLoading(false); }
  }, [api, setError, workspaceId, truthful]);
  useEffect(() => { void load(); }, [load, reload]);
  useEffect(() => {
    if (!truthful || !uploads) return;
    let live = true;
    unfinishedUploads(api, workspaceId).then((sessions) => { if (live) setUnfinished(sessions.length); }, () => { if (live) setUnfinished(null); });
    return () => { live = false; };
  }, [api, workspaceId, truthful, reload, uploads]);

  // Remove asks first, then takes the song off the list at once and waits out the Undo window
  // before telling the server: Undo inside it really puts the song back, because nothing was
  // deleted yet. Leaving the page commits what is waiting.
  const [asking, setAsking] = useState<Asset | null>(null);
  const commit = useCallback(async (id: string) => {
    const waiting = pending.current.get(id);
    if (!waiting) return;
    window.clearTimeout(waiting.timer);
    pending.current.delete(id);
    setBusyId(id);
    try {
      await api(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }, workspaceId);
      await refreshAccount();
    } catch (problem) {
      // the server kept it: the song comes back, and the page says why
      setAssets((old) => (old.some((entry) => entry.id === id) ? old : insertAt(old, waiting.asset, waiting.at)));
      dispatch({ type: 'restored', asset: waiting.asset, at: waiting.at });
      setError((problem as Error).message);
    } finally { setBusyId(''); }
  }, [api, workspaceId, refreshAccount, setError]);
  useEffect(() => {
    const waiting = pending.current;
    return () => { for (const id of [...waiting.keys()]) void commit(id); };
  }, [commit]);
  const remove = (asset: Asset) => {
    setError('');
    const at = assets.findIndex((entry) => entry.id === asset.id);
    setAssets((old) => old.filter((entry) => entry.id !== asset.id));
    dispatch({ type: 'removed', id: asset.id });
    const timer = window.setTimeout(() => void commit(asset.id), UNDO_WINDOW_MS);
    pending.current.set(asset.id, { asset, at: Math.max(at, 0), timer });
  };
  const undoRemove = (asset: Asset) => {
    const waiting = pending.current.get(asset.id);
    if (!waiting) throw new Error(`${asset.name} was already removed for good. Upload it again to add it back.`);
    window.clearTimeout(waiting.timer);
    pending.current.delete(asset.id);
    setAssets((old) => insertAt(old, waiting.asset, waiting.at));
    dispatch({ type: 'restored', asset: waiting.asset, at: waiting.at });
  };

  const track = player.track;
  const busy = truthful ? isBusy(state) : loading;
  const overview = overviewOf(state, unfinished);
  const storage = account ? (account.usage?.storage.used_bytes ?? account.entitlement.storage_used_bytes) : null;
  const limit = account ? (account.usage?.storage.limit_bytes ?? account.entitlement.storage_limit_bytes) : null;
  const list = (assets.length > 0 || nextCursor) && (
    <>
      <div className="cloud-library-list">{assets.map((asset, at) => (
        <article className="cloud-library-row" key={asset.id}>
          <span className="cloud-library-icon" aria-hidden="true">♪</span>
          <div className="cloud-library-meta"><strong><Truncate text={asset.name} /></strong><span>{asset.format?.toUpperCase() ?? 'Audio'} · {bytes(asset.size)}{asset.duration_seconds ? ` · ${Math.max(1, Math.round(asset.duration_seconds / 60))} min` : ''}</span></div>
          <button aria-label={`Listen to ${asset.name}`} onClick={() => void player.start(assets, at)} disabled={player.preparing === asset.id || busyId === asset.id}>{player.preparing === asset.id ? 'Opening…' : track?.id === asset.id ? 'Play again' : 'Listen'}</button>
          <button aria-label={`Remove ${asset.name}`} onClick={() => setAsking(asset)} disabled={busyId === asset.id}>Remove</button>
        </article>
      ))}</div>
      {nextCursor && <button onClick={() => void load(nextCursor, true)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
    </>
  );
  const empty = uploads
    ? <EmptyState title="Your library is empty" actions={<button className="primary" onClick={() => go('uploads')}>Add tracks</button>}>Upload tracks from your device to begin. They stay private to this workspace.</EmptyState>
    : <EmptyState title="Your library is empty">No songs are stored in this workspace.</EmptyState>;
  const body = !truthful
    ? (loading && assets.length === 0 ? <Skeleton variant="library" lines={4} label="Loading your library" /> : assets.length === 0 ? empty : list)
    : state.status === 'loading' ? <Skeleton variant="library" lines={4} label="Loading your library" />
    : state.status === 'failed' ? (
      <div className="cloud-card cloud-library-failed" role="alert">
        <h2>Your library didn’t load</h2>
        <p>{state.message} Your songs are safe; only the list didn’t arrive.</p>
        <button className="primary" onClick={() => void load()} disabled={state.retrying}>{state.retrying ? 'Trying again…' : 'Try again'}</button>
      </div>)
    : state.status === 'empty' ? (uploads && unfinished ? (
      <EmptyState title="Your first songs are on the way" actions={<button className="primary" onClick={() => go('uploads')}>Carry on uploading</button>}>{`${countOf(unfinished, 'upload')} ${unfinished === 1 ? 'hasn’t' : 'haven’t'} finished yet. Choose the same file again on Add music to carry on.`}</EmptyState>
    ) : empty)
    : <>{state.stale && <p className="cloud-feedback" role="status">This list may be out of date: {state.stale} <button onClick={() => void load()}>Try again</button></p>}{list}</>;
  return (
    <section className="cloud-library">
      <div className="cloud-library-heading">
        <div><p className="cloud-eyebrow">PRIVATE TO THIS WORKSPACE</p><p>Listen from any song and the rest of the list follows, with the next song loaded ahead. Removing a song frees its space once the few seconds to undo it have passed.</p></div>
        <div><button onClick={() => void load()} disabled={busy}>Refresh</button>{uploads && <button className="primary" onClick={() => go('uploads')}>Upload tracks</button>}</div>
      </div>
      {truthful && (
        <section className="cloud-library-overview" aria-label="Library overview">
          <div><span className="cloud-eyebrow">SONGS</span><strong data-testid="library-songs">{songWords(overview)}</strong></div>
          {storage !== null && limit !== null && <div><span className="cloud-eyebrow">STORAGE</span><strong data-testid="library-storage">{bytes(storage)} of {bytes(limit)}</strong></div>}
          {uploads && <div><span className="cloud-eyebrow">UNFINISHED UPLOADS</span><strong data-testid="library-unfinished">{overview.processing === null ? 'Not known' : overview.processing}</strong>{overview.processing ? <button onClick={() => go('uploads')}>Carry on</button> : null}</div>}
        </section>
      )}
      {track && !shared && (
        <section className="cloud-card cloud-library-player" aria-label="Player">
          <div>
            <p className="cloud-eyebrow">NOW PLAYING</p>
            <strong data-testid="now-playing">{track.name}</strong>
            {player.upNext && <p className="cloud-up-next" data-testid="up-next">Up next: {player.upNext.name}{player.bufferedId === player.upNext.id ? ' · loaded' : ''}</p>}
          </div>
          <audio ref={audioRef} controls autoPlay={player.autoplay} src={track.url} data-track={track.id}
            onLoadedMetadata={player.loaded} onTimeUpdate={player.heard} onPause={player.heard} onPlaying={() => { player.heard(); void player.prefetchNext(); }}
            onEnded={player.advance} onError={() => void player.refreshUrl()} />
        </section>
      )}
      {body}
      {asking && (
        <ConfirmDialog
          title={`Remove ${asking.name}?`}
          body="It leaves your library and the space it uses is freed."
          destructive
          onConfirm={() => remove(asking)}
          onClose={() => setAsking(null)}
          undo={() => undoRemove(asking)}
        />
      )}
    </section>
  );
}
