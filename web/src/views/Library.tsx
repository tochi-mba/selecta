import { useEffect, useState } from 'react';
import { get, MixData, post, SongRow } from '../api';
import { analysingWords, askedToAnalyse, clock } from '../lib';
import { ViewProps } from './shared';

const FILTERS = [
  { name: 'ready', label: 'Ready' },
  { name: 'not_yet', label: 'Not analysed yet' },
  { name: 'priority', label: 'Priority list' },
  { name: 'set_aside', label: 'Set aside' },
  { name: 'all', label: 'Everything' },
];

export function Library({ mix, now, player, setMixData, setView, notify, status, refreshStatus }: ViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ready');
  const [rows, setRows] = useState<SongRow[] | null>(null);
  const line = status.analysing ?? [];

  const load = () =>
    get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=${filter}&limit=200`)
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    const wait = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(wait);
  }, [query, filter]);

  useEffect(() => {
    if (!line.length) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [line.length, query, filter]);

  const add = async (song: SongRow, position?: number) => {
    setMixData(await post<MixData>('/mix/songs', { song_id: song.id, position }));
    notify(position !== undefined ? `${song.title} plays next.` : `Added ${song.title}.`, true);
  };
  const never = async (song: SongRow) => {
    await post(`/songs/${song.id}/never`);
    notify(song.never ? `${song.title} can play again.` : `${song.title} won’t be picked for mixes.`);
    void load();
  };
  const startFrom = async (song: SongRow) => {
    const data = await post<MixData>(`/vibes/pick/build?start=${song.id}`);
    setMixData(data);
    setView('Now');
    void player.playFrom(0);
    notify(`A mix starting from ${song.title}.`, true);
  };
  const left = Math.max(status.counts.music - status.counts.analysed, 0);
  const analyseAll = async () => {
    await post('/analysis/start');
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };
  const analyse = async (song: SongRow) => {
    const { ahead } = await post<{ ahead: number }>(`/songs/${song.id}/analyse`);
    refreshStatus();
    notify(askedToAnalyse(song.title, ahead));
  };
  const setPriority = async (song: SongRow) => {
    await post(`/songs/${song.id}/priority?priority=${song.priority ? 0 : 100}`);
    notify(song.priority ? `${song.title} moved to background processing.` : `${song.title} moved to the priority list.`, true);
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
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map((option) => (
          <button key={option.name} aria-pressed={filter === option.name} onClick={() => setFilter(option.name)}>
            {option.label}
          </button>
        ))}
      </div>
      {filter === 'not_yet' && left > 0 && (
        <div className="row wrap analyse-all">
          <span className="hint">
            {left} song{left === 1 ? '' : 's'} left, about {Math.ceil((left * 25) / 3600)} hour{left * 25 > 3600 ? 's' : ''} in the background.
          </span>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <button onClick={() => void analyseAll()}>Analyse them all</button>
          )}
        </div>
      )}
      {rows === null && <p className="hint">Loading your songs…</p>}
      <ul className="rows">
        {rows?.map((song) => {
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
                {ready ? (
                  <>
                    <button onClick={() => void startFrom(song)} title="Build a mix that starts here">Start a mix</button>
                    <button onClick={() => void add(song)} disabled={mix.some((item) => item.song_id === song.id)}>
                      {mix.some((item) => item.song_id === song.id) ? 'In the mix' : 'Add'}
                    </button>
                    {now.phase !== 'idle' && (
                      <button
                        onClick={() => void add(song, now.position + 1)}
                        disabled={mix.some((item) => item.song_id === song.id)}
                      >
                        Play next
                      </button>
                    )}
                  </>
                ) : (
                  filter !== 'set_aside' && (
                    <button disabled={line.includes(song.id)} onClick={() => void analyse(song)}>
                      {analysingWords(line, song.id)}
                    </button>
                  )
                )}
                {filter !== 'set_aside' && (
                  <>
                    <button
                      aria-pressed={song.priority}
                      onClick={() => void setPriority(song)}
                      title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup"
                    >
                      {song.priority ? 'Priority: on' : 'Prioritize'}
                    </button>
                    <button aria-pressed={song.never} onClick={() => void never(song)} title="Selecta won’t pick this when it builds a mix">
                      {song.never ? 'Never: on' : 'Never play'}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rows?.length === 0 && (
        <p className="lede">
          {query
            ? `Nothing matches “${query}”.`
            : filter === 'ready'
              ? `No songs are ready yet. ${status.counts.music} are waiting in the Workshop.`
              : 'Nothing here.'}
        </p>
      )}
      {rows?.length === 200 && <p className="hint">Showing the first 200. Search to narrow it down.</p>}
    </main>
  );
}
