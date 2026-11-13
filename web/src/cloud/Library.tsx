import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Account, Api, Asset, bytes, Page } from './api';
import { INITIAL_LIBRARY, isBusy, libraryReducer, overviewOf, songWords } from './libraryState';
import { unfinishedUploads } from './uploadParts';
import { useSharedLibraryPlayer } from './cloudTransport';
import { useCloudPlayer } from './useCloudPlayer';
import { DeviceLibrary } from './lf-personal/PersonalWorkspace';
import { LegacyFolderWatchEntry } from './lf-personal/FolderWatches';

// The Cloud library: private originals, played from prepared playback files. Listening starts a
// run from that song to the end of the list, with the next song buffered ahead (see
// useCloudPlayer). Removing songs is how an over-quota account makes room, so it stays available.
//
// `truthful` (`cloud.library_states`, ADR-0421): loading, failed, empty and ready are told apart
// (libraryState.ts), so a list that didn't load never says "Your library is empty", and an
// overview above the list counts the songs, the storage they use and unfinished uploads.

/** Historical cloud asset list remains available for pre-migration workspaces. */
export function LibraryPanel(props: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  refreshAccount: () => Promise<void>;
  go: (page: Page) => void;
  reload?: number;
  truthful?: boolean;
  account?: Account | null;
  localFirst?: boolean;
}) {
  if (props.localFirst) return <DeviceLibrary api={props.api} workspaceId={props.workspaceId} go={props.go} revision={props.reload} />;
  return <LegacyLibraryPanel {...props} />;
}

function LegacyLibraryPanel({ api, workspaceId, setError, refreshAccount, go, reload, truthful = true, account }: {
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
      const page = await api<{ assets: Asset[]; next_cursor: string | null }>(`/assets?${query}`, {}, workspaceId);
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
    if (!truthful) return;
    let live = true;
    unfinishedUploads(api, workspaceId).then((sessions) => { if (live) setUnfinished(sessions.length); }, () => { if (live) setUnfinished(null); });
    return () => { live = false; };
  }, [api, workspaceId, truthful, reload]);

  const remove = async (asset: Asset) => {
    if (!window.confirm(`Remove ${asset.name} from your library?`)) return;
    setBusyId(asset.id); setError('');
    try {
      await api(`/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' }, workspaceId);
      setAssets((old) => old.filter((entry) => entry.id !== asset.id));
      dispatch({ type: 'removed', id: asset.id });
      await refreshAccount();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusyId(''); }
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
          <div className="cloud-library-meta"><strong>{asset.name}</strong><span>{asset.format?.toUpperCase() ?? 'Audio'} · {bytes(asset.size)}{asset.duration_seconds ? ` · ${Math.max(1, Math.round(asset.duration_seconds / 60))} min` : ''}</span></div>
          <button aria-label={`Listen to ${asset.name}`} onClick={() => void player.start(assets, at)} disabled={player.preparing === asset.id || busyId === asset.id}>{player.preparing === asset.id ? 'Opening…' : track?.id === asset.id ? 'Play again' : 'Listen'}</button>
          <button aria-label={`Remove ${asset.name}`} onClick={() => void remove(asset)} disabled={busyId === asset.id}>Remove</button>
        </article>
      ))}</div>
      {nextCursor && <button onClick={() => void load(nextCursor, true)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
    </>
  );
  const empty = <div className="cloud-card"><h2>Your library is empty</h2><p>Start by uploading tracks from your device.</p><button className="primary" onClick={() => go('uploads')}>Add tracks</button></div>;
  const body = !truthful
    ? (loading && assets.length === 0 ? <p>Loading your library…</p> : assets.length === 0 ? empty : list)
    : state.status === 'loading' ? <p role="status">Loading your library…</p>
    : state.status === 'failed' ? (
      <div className="cloud-card cloud-library-failed" role="alert">
        <h2>Your library didn’t load</h2>
        <p>{state.message} Your songs are safe; only the list didn’t arrive.</p>
        <button className="primary" onClick={() => void load()} disabled={state.retrying}>{state.retrying ? 'Trying again…' : 'Try again'}</button>
      </div>)
    : state.status === 'empty' ? (unfinished ? (
      <div className="cloud-card"><h2>Your first songs are on the way</h2><p>{unfinished} {unfinished === 1 ? 'upload hasn’t' : 'uploads haven’t'} finished yet. Choose the same file again on Add music to carry on.</p><button className="primary" onClick={() => go('uploads')}>Carry on uploading</button></div>
    ) : empty)
    : <>{state.stale && <p className="cloud-feedback" role="status">This list may be out of date: {state.stale} <button onClick={() => void load()}>Try again</button></p>}{list}</>;
  return (
    <section className="cloud-library">
      <LegacyFolderWatchEntry />
      <div className="cloud-library-heading">
        <div><p className="cloud-eyebrow">PRIVATE TO THIS WORKSPACE</p><p>Listen from any song and the rest of the list follows, with the next song loaded ahead. Removing songs frees space at once.</p></div>
        <div><button onClick={() => void load()} disabled={busy}>Refresh</button><button className="primary" onClick={() => go('uploads')}>Upload tracks</button></div>
      </div>
      {truthful && (
        <section className="cloud-library-overview" aria-label="Library overview">
          <div><span className="cloud-eyebrow">SONGS</span><strong data-testid="library-songs">{songWords(overview)}</strong></div>
          {storage !== null && limit !== null && <div><span className="cloud-eyebrow">STORAGE</span><strong data-testid="library-storage">{bytes(storage)} of {bytes(limit)}</strong></div>}
          <div><span className="cloud-eyebrow">UNFINISHED UPLOADS</span><strong data-testid="library-unfinished">{overview.processing === null ? 'Not known' : overview.processing}</strong>{overview.processing ? <button onClick={() => go('uploads')}>Carry on</button> : null}</div>
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
    </section>
  );
}
