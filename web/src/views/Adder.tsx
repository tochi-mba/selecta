import { CSSProperties, KeyboardEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Suggestion } from '../api';
import { useApi } from '../requestContext';
import { analysingWords, askedToAnalyse } from '../lib';
import { Action, Problem, Skeleton } from '../ui/controls';
import { TransitionsWorkedOutLive } from './liveTransitions';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { useMixPath } from './mixScope';
import { flyInto } from './feelEditor';

/** What could go at this place in the mix: the best fits first, and the same order when searching. A
 * song that can't go in yet says why, and how to get it ready. */
export function Adder(props: {
  position: number;
  onAdd: (song: Suggestion) => unknown;
  onClose: () => void;
  notify: (message: string) => void;
  line: number[];
  refreshStatus: () => void;
}) {
  const { get, post } = useApi();
  const { position, onAdd, onClose, notify, line, refreshStatus } = props;
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<Suggestion[] | null>(null);
  const at = useMixPath();
  const [failed, setFailed] = useState(false);
  // without analysis nothing is ranked by fit: these are the songs that play here, in library order
  const unranked = useContext(TransitionsWorkedOutLive);
  const asked = useRef(0);
  // MI-0138-08: the chosen song is marked at once, and only goes in when the server has added it
  const [adding, setAdding] = useState<Suggestion | null>(null);
  const addingNow = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const add = async (song: Suggestion) => {
    if (addingNow.current) return;
    addingNow.current = true;
    setAdding(song);
    // the feel (ADR-0477): where the chosen suggestion was, so the new row can fly in from there
    const from = list.current?.querySelector(`[data-suggestion="${song.song_id}"]`)?.getBoundingClientRect();
    try {
      await onAdd(song);
      // only the row that really holds this song at this place: a refused add flies nothing
      flyInto(from, () => document.querySelector(`[data-position="${position}"][data-song-key^="${song.song_id}#"]`));
    } finally {
      addingNow.current = false;
      setAdding(null);
    }
  };

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

  // A song being analysed joins the list by itself once it's ready. A hidden tab doesn't ask, and
  // asks straight away when it's looked at again.
  useVisiblePoll(load, 4000, line.length > 0);

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
    if (event.key === 'Enter' && first) { event.preventDefault(); void add(first); }
  };

  return (
    // the feel (ADR-0477): the gap opens with an arrival and the suggestions come in one after another
    <div className="adder" data-arrive="">
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
      <p className="hint">{unranked ? 'Songs that play on this device and aren’t in the mix yet' : query ? 'Best fit first' : 'These would fit best here'}</p>
      {position >= 0 && <p className="hint adder-where">It goes in as number {position + 1}.</p>}
      {adding && <p className="hint" role="status">Adding {adding.title}…</p>}
      {failed && <Problem retry={load}>Couldn’t find songs for this position. Try again.</Problem>}
      {songs === null && !failed && <Skeleton variant="library" lines={2} label="Finding what fits" />}
      {songs?.length === 0 && (
        <p className="hint">{query ? 'Nothing matches that.' : unranked ? 'Every song that plays on this device is already in the mix. Connect more music in Library to add others.' : 'Nothing to suggest here yet.'}</p>
      )}
      <ul className="suggestions" data-stagger="" ref={list}>
        {songs?.map((song, index) => (
          <li key={song.song_id} style={{ '--i': index } as CSSProperties} data-suggestion={song.song_id}>
            <button className="suggestion" disabled={!song.analysed} aria-busy={adding?.song_id === song.song_id || undefined} onClick={() => void add(song)}>
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
