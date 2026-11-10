import { useCallback, useEffect, useRef, useState } from 'react';
import { Api, Asset, bytes, Page } from './api';
import { useCloudPlayer } from './useCloudPlayer';

// The Cloud library: private originals, played from prepared playback files. Listening starts a
// run from that song to the end of the list, with the next song buffered ahead (see
// useCloudPlayer). Removing songs is how an over-quota account makes room, so it stays available.

export function LibraryPanel({ api, workspaceId, setError, refreshAccount, go, reload }: {
  api: Api;
  workspaceId: string;
  setError: (value: string) => void;
  refreshAccount: () => Promise<void>;
  go: (page: Page) => void;
  /** Bumped when the server says the library changed, so the list reads again. */
  reload?: number;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const player = useCloudPlayer({ api, workspaceId, audio: audioRef, setError });

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const page = await api<{ assets: Asset[]; next_cursor: string | null }>(`/assets?${query}`, {}, workspaceId);
      setAssets((old) => append ? [...old, ...page.assets] : page.assets);
      setNextCursor(page.next_cursor);
    } catch (problem) { setError((problem as Error).message); }
    finally { setLoading(false); }
  }, [api, setError, workspaceId]);
  useEffect(() => { void load(); }, [load, reload]);

  const remove = async (asset: Asset) => {
    if (!window.confirm(`Remove ${asset.name} from your library?`)) return;
    setBusyId(asset.id); setError('');
    try {
      await api(`/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' }, workspaceId);
      setAssets((old) => old.filter((entry) => entry.id !== asset.id));
      await refreshAccount();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusyId(''); }
  };

  const track = player.track;
  return (
    <section className="cloud-library">
      <div className="cloud-library-heading">
        <div><p className="cloud-eyebrow">PRIVATE TO THIS WORKSPACE</p><p>Listen from any song and the rest of the list follows, with the next song loaded ahead. Removing songs frees space at once.</p></div>
        <div><button onClick={() => void load()} disabled={loading}>Refresh</button><button className="primary" onClick={() => go('uploads')}>Upload tracks</button></div>
      </div>
      {track && (
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
      {loading && assets.length === 0 ? <p>Loading your library…</p> : assets.length === 0
        ? <div className="cloud-card"><h2>Your library is empty</h2><p>Start by uploading tracks from your device.</p><button className="primary" onClick={() => go('uploads')}>Add tracks</button></div>
        : <>
          <div className="cloud-library-list">{assets.map((asset, at) => (
            <article className="cloud-library-row" key={asset.id}>
              <span className="cloud-library-icon" aria-hidden="true">♪</span>
              <div className="cloud-library-meta"><strong>{asset.name}</strong><span>{asset.format?.toUpperCase() ?? 'Audio'} · {bytes(asset.size)}{asset.duration_seconds ? ` · ${Math.max(1, Math.round(asset.duration_seconds / 60))} min` : ''}</span></div>
              <button aria-label={`Listen to ${asset.name}`} onClick={() => void player.start(assets, at)} disabled={player.preparing === asset.id || busyId === asset.id}>{player.preparing === asset.id ? 'Opening…' : track?.id === asset.id ? 'Play again' : 'Listen'}</button>
              <button aria-label={`Remove ${asset.name}`} onClick={() => void remove(asset)} disabled={busyId === asset.id}>Remove</button>
            </article>
          ))}</div>
          {nextCursor && <button onClick={() => void load(nextCursor, true)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
        </>}
    </section>
  );
}
