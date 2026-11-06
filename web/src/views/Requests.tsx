import { useEffect, useState } from 'react';
import { del, get, post, SongRow } from '../api';

type RequestRow = {
  id: number; song_id: number; title: string | null; artist: string | null;
  status: string; available: number; reason?: string;
};
type RequestList = { requests: RequestRow[] };

/** Persistent requests are separate from the playing order until a safe placement is ready. */
export function Requests() {
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SongRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    const refresh = () => get<RequestList>('/requests').then(data => {
      if (live) setRequests(data.requests);
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
      const data = await del<RequestList>(`/requests/${request.id}`);
      setRequests(data.requests); setMessage('Request cancelled.');
    } catch { setError('Could not cancel that request. It is still on the list.'); }
    finally { setBusy(false); }
  };

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
        <button disabled={busy} onClick={() => void cancel(request)} aria-label={`Cancel request for ${request.title ?? 'unavailable song'}`}>Cancel request</button>
      </li>)}</ul>}
  </section>;
}
