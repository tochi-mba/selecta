import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { get, post, Suggestion } from '../api';
import { analysingWords, askedToAnalyse } from '../lib';
import { Action, Problem, Skeleton } from '../ui/controls';
import { useMixPath } from './mixScope';

/** What could go at this place in the mix: the best fits first, and the same order when searching. A
 * song that can't go in yet says why, and how to get it ready. */
export function Adder(props: {
  position: number;
  onAdd: (song: Suggestion) => void;
  onClose: () => void;
  notify: (message: string) => void;
  line: number[];
  refreshStatus: () => void;
}) {
  const { position, onAdd, onClose, notify, line, refreshStatus } = props;
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<Suggestion[] | null>(null);
  const at = useMixPath();
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);

  const load = useCallback(() => {
    const mine = ++asked.current;
    return get<{ songs: Suggestion[] }>(at(`/mix/suggest?position=${position}&q=${encodeURIComponent(query)}&limit=${query ? 30 : 8}`))
      .then((data) => { if (mine === asked.current) { setSongs(data.songs); setFailed(false); } })
      .catch(() => { if (mine === asked.current) setFailed(true); });
  }, [at, position, query]);
  useEffect(() => {
    setSongs(null);
    setFailed(false);
    const wait = window.setTimeout(load, query ? 150 : 0);
    return () => { asked.current += 1; window.clearTimeout(wait); };
  }, [load]);

  // A song being analysed joins the list by itself once it's ready.
  useEffect(() => {
    if (!line.length) return;
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [line.length, load]);

  const analyse = async (song: Suggestion) => {
    const { ahead, seconds } = await post<{ ahead: number; seconds?: number }>(`/songs/${song.song_id}/analyse`);
    refreshStatus();
    notify(askedToAnalyse(song.title, ahead, seconds));
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
    const first = songs?.find((song) => song.analysed);
    if (event.key === 'Enter' && first) { event.preventDefault(); onAdd(first); }
  };

  return (
    <div className="adder">
      <div className="row">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keys}
          placeholder="Search, or pick from below"
          aria-label="Search for a song to add here"
        />
        <button onClick={onClose}>Cancel</button>
      </div>
      <p className="hint">{query ? 'Best fit first' : 'These would fit best here'}</p>
      {position >= 0 && <p className="hint adder-where">It goes in as number {position + 1}.</p>}
      {failed && <Problem retry={load}>Couldn’t find songs for this position. Try again.</Problem>}
      {songs === null && !failed && <Skeleton variant="library" lines={2} label="Finding what fits" />}
      {songs?.length === 0 && <p className="hint">Nothing matches that.</p>}
      <ul className="suggestions">
        {songs?.map((song) => (
          <li key={song.song_id}>
            <button className="suggestion" disabled={!song.analysed} onClick={() => onAdd(song)}>
              <b>{song.title}</b>
              <span>{song.artist}</span>
              <small>{song.reason}</small>
            </button>
            {!song.analysed && (
              <Action disabled={line.includes(song.song_id)} run={() => analyse(song)}>
                {analysingWords(line, song.song_id)}
              </Action>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
