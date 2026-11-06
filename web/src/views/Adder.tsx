import { KeyboardEvent, useEffect, useState } from 'react';
import { get, post, Suggestion } from '../api';
import { analysingWords, askedToAnalyse } from '../lib';
import { Action } from '../ui/controls';
import { useMixPath } from './mixScope';

/** What could go at this place in the mix: the best fits first, and the same order when searching. */
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

  const load = () => {
    get<{ songs: Suggestion[] }>(at(`/mix/suggest?position=${position}&q=${encodeURIComponent(query)}&limit=${query ? 30 : 8}`))
      .then((data) => setSongs(data.songs))
      .catch(() => setSongs([]));
  };
  useEffect(() => {
    const wait = window.setTimeout(load, query ? 150 : 0);
    return () => window.clearTimeout(wait);
  }, [query, position]);

  // A song being analysed joins the list by itself once it's ready.
  useEffect(() => {
    if (!line.length) return;
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [line.length, query, position]);

  const analyse = async (song: Suggestion) => {
    const { ahead, seconds } = await post<{ ahead: number; seconds?: number }>(`/songs/${song.song_id}/analyse`);
    refreshStatus();
    notify(askedToAnalyse(song.title, ahead, seconds));
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') onClose();
    const first = songs?.find((song) => song.analysed);
    if (event.key === 'Enter' && first) onAdd(first);
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
      {songs === null && <p className="hint">Finding what fits…</p>}
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
