import { useEffect, useRef, useState } from 'react';
import { del, get, MixData, MixItem, post, SongRow } from '../api';
import { SetPlayer } from '../player';

type RequestRow = {
  id: number; song_id: number; title: string | null; artist: string | null;
  status: string; available: number; reason?: string;
  offer?: string; ready?: boolean; needs_approval?: boolean;
  route?: { id: number; title: string }[];
};
type RequestList = { requests: RequestRow[] };

/** Persistent requests are separate from the playing order until a safe placement is ready. */
export function Requests(props: {
  playback?: { mix: MixItem[]; player: SetPlayer; onMix: (data: MixData) => void };
  visible?: boolean;
}) {
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SongRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const latest = useRef(props.playback);
  latest.current = props.playback;

  const playbackBody = () => {
    const active = latest.current;
    if (!active) return null;
    const now = active.player.state;
    if (!['playing', 'paused'].includes(now.phase) || now.inSeam || now.duration - now.songTime < 8) return null;
    return { order: active.mix.map(item => item.song_id), position: now.position,
      phase: now.phase, seconds_left: now.duration - now.songTime };
  };

  useEffect(() => {
    if (!props.playback) return;
    let live = true;
    let working = false;
    const consider = async () => {
      const body = playbackBody();
      if (!body || working) return;
      working = true;
      try {
        const data = await post<RequestList>('/requests/consider', body);
        if (!live) return;
        setRequests(data.requests);
        const ready = data.requests.find(request => request.ready && request.offer);
        const fresh = playbackBody();
        if (!ready || !fresh || JSON.stringify(fresh.order) !== JSON.stringify(body.order)) return;
        // Use the current audio position after planning, which may have taken several seconds.
        const changed = await post<MixData>('/requests/insert', { ...fresh, offer: ready.offer });
        if (!live) return;
        latest.current?.onMix(changed);
        setMessage(`${ready.title ?? 'Your request'} has joined the mix ahead of playback.`);
        setRequests(previous => previous?.filter(request => request.id !== ready.id) ?? []);
      } catch {
        // A moving playhead, edit or cancellation invalidates a proposal normally.
        // The persisted request remains waiting and is reconsidered on the next pass.
      } finally { working = false; }
    };
    void consider();
    const timer = window.setInterval(() => void consider(), 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [!!props.playback]);

  useEffect(() => {
    let live = true;
    const refresh = () => get<RequestList>('/requests').then(data => {
      if (live) setRequests(before => data.requests.map(row => ({ ...before?.find(old => old.id === row.id), ...row })));
    }).catch(() => { if (live) setError('Could not load requests. Your saved requests have not been cleared.'); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let live = true;
    setMatches([]);
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      void get<SongRow[]>(`/songs?q=${encodeURIComponent(query.trim())}&state=all&limit=20`)
        .then(rows => { if (live) setMatches(rows); })
        .catch(() => { if (live) setError('Search could not load. Try again.'); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);

  const add = async (song: SongRow) => {
    setBusy(true); setError('');
    try {
      const data = await post<RequestList>('/requests', { song_id: song.id });
      setRequests(data.requests); setQuery('');
      setMessage(`${song.title ?? 'Song'} is on your request list.`);
    } catch { setError('Could not save that request. Try again.'); }
    finally { setBusy(false); }
  };
  const cancel = async (request: RequestRow) => {
    setBusy(true); setError('');
    try {
      const data = await del<RequestList & { cancelled?: boolean }>(`/requests/${request.id}`);
      setRequests(data.requests); setMessage(data.cancelled === false ? 'This request already joined the mix. You can change it in Edit.' : 'Request cancelled.');
    } catch { setError('Could not cancel that request. It is still on the list.'); }
    finally { setBusy(false); }
  };

  const approve = async (request: RequestRow) => {
    const body = playbackBody();
    if (!body || !request.offer) { setError('Resume the mix to reconsider this route.'); return; }
    setBusy(true); setError('');
    try {
      await post('/requests/approve', { ...body, offer: request.offer });
      setMessage('Route approved. Preparing its handovers before adding it.');
    } catch { setError('That route changed. Selecta will find a fresh proposal.'); }
    finally { setBusy(false); }
  };

  if (props.visible === false) return null;

  return <section className="panel stack" aria-label="Song requests">
    <h2>Requests</h2>
    <p>Ask for a song without interrupting the mix. Requests wait for a place that fits.</p>
    <label>Request a song<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Song or artist" /></label>
    {matches.length > 0 && <ul className="suggestions">{matches.map(song => {
      const pending = requests?.some(request => request.song_id === song.id);
      return <li key={song.id}><button disabled={busy || pending} onClick={() => void add(song)}>
        {song.title ?? 'Untitled'} · {song.artist ?? 'Unknown artist'}{pending ? ' · Requested' : ''}
      </button></li>;
    })}</ul>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {requests === null ? <p>Loading requests…</p> : requests.length === 0 ? <p>No requests waiting.</p> :
      <ul className="suggestions">{requests.map(request => <li key={request.id}>
        <div><b>{request.title ?? 'Unavailable song'}</b><p>{request.artist}</p>
          <small>{!request.available ? 'This song is no longer available in your library.' : request.reason ?? 'Waiting for a suitable place.'}</small></div>
        {request.needs_approval && <div>
          <p>Proposed route: {request.route?.map(song => song.title).join(' → ')}</p>
          <button disabled={busy} onClick={() => void approve(request)}>Approve bridge route</button>
        </div>}
        <button disabled={busy} onClick={() => void cancel(request)} aria-label={`Cancel request for ${request.title ?? 'unavailable song'}`}>Cancel request</button>
      </li>)}</ul>}
  </section>;
}
