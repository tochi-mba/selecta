import { useEffect, useState } from 'react';
import { clock, get, post, SongRow } from '../api';
import { ViewProps } from './shared';

const FILTERS = [
  { name: 'ready', label: 'Ready' },
  { name: 'not_yet', label: 'Not analysed yet' },
  { name: 'set_aside', label: 'Set aside' },
  { name: 'all', label: 'Everything' },
];

export function Library({ refreshMix, mix, player, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ready');
  const [rows, setRows] = useState<SongRow[]>([]);
  const [added, setAdded] = useState('');

  const load = () =>
    get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=${filter}&limit=200`).then(setRows).catch(() => {});
  useEffect(() => {
    const wait = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(wait);
  }, [query, filter]);

  const add = async (song: SongRow, position?: number) => {
    await post('/mix/songs', { song_id: song.id, position });
    refreshMix();
    setAdded(`${song.title} added${position !== undefined ? ' next' : ''}.`);
  };
  const never = async (song: SongRow) => {
    await post(`/songs/${song.id}/never`);
    void load();
  };

  return (
    <main className="page">
      <h1 className="display small">Library</h1>
      <input
        className="wide"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by artist or title"
        aria-label="Search your library"
      />
      <div className="chips">
        {FILTERS.map((option) => (
          <button key={option.name} aria-pressed={filter === option.name} onClick={() => setFilter(option.name)}>
            {option.label}
          </button>
        ))}
      </div>
      {added && <p className="notice" role="status">{added}</p>}
      <ul className="rows">
        {rows.map((song) => {
          const ready = song.bpm !== null;
          return (
            <li key={song.id} className={`song-row ${song.never ? 'never' : ''}`}>
              <div className="song-name">
                <b>{song.title ?? 'Untitled'}</b>
                <span>{song.artist ?? 'Unknown artist'}</span>
              </div>
              <small className="facts">
                {ready ? `${Math.round(song.bpm!)} BPM ${song.camelot ?? ''}` : 'Not analysed'} · {clock(song.duration)}
                {song.lyric_status === 'synced' ? ' · lyrics' : ''}
              </small>
              <div className="song-actions">
                {ready && (
                  <>
                    <button onClick={() => void add(song)}>Add</button>
                    <button onClick={() => void add(song, now.phase === 'idle' ? 1 : now.position + 1)} disabled={!mix.length}>
                      Play next
                    </button>
                  </>
                )}
                <button aria-pressed={song.never} onClick={() => void never(song)} title="Selecta won’t pick this when it builds a mix">
                  {song.never ? 'Never: on' : 'Never play'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <p className="lede">
          {filter === 'ready' ? 'No analysed songs match. Try the Workshop to analyse more.' : 'Nothing matches that.'}
        </p>
      )}
      {player && null}
    </main>
  );
}
