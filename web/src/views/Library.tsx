import { useCallback, useEffect, useRef, useState } from 'react';
import { get, LibraryPage, LibrarySong, MixData, post } from '../api';
import { analysingWords, analysisWords, askedToAnalyse, clock, etaWords } from '../lib';
import { setQuery as setAddressQuery, useQueryParam } from '../router';
import { Action, Problem, Sheet, Skeleton, Status, StatusKind } from '../ui/controls';
import { ViewProps } from './shared';

const FILTERS = [
  { name: 'ready', label: 'Ready' },
  { name: 'not_yet', label: 'Not analysed yet' },
  { name: 'attention', label: 'Needs attention' },
  { name: 'priority', label: 'Priority list' },
  { name: 'set_aside', label: 'Set aside' },
  { name: 'all', label: 'Everything' },
];

const SORTS = [
  { name: 'title', label: 'Title' },
  { name: 'artist', label: 'Artist' },
  { name: 'tempo', label: 'Tempo' },
  { name: 'recent', label: 'Newest first' },
];

const READINESS: Record<string, { kind: StatusKind; words: string }> = {
  mix_ready: { kind: 'ready', words: 'Ready for mixes' },
  analysed_incomplete: { kind: 'warning', words: 'Not ready for mixes' },
  queued: { kind: 'queued', words: 'Waiting to be analysed' },
  processing: { kind: 'working', words: 'Being analysed' },
  needs_attention: { kind: 'failed', words: 'Couldn’t be analysed' },
  set_aside: { kind: 'unavailable', words: 'Set aside' },
  excluded: { kind: 'unavailable', words: 'Never plays' },
  missing: { kind: 'failed', words: 'File is missing' },
};

function SongDetails({ song, onClose, onChanged, notify }: { song: LibrarySong; onClose: () => void; onChanged: () => void; notify: ViewProps['notify'] }) {
  const [bpm, setBpm] = useState(song.override_bpm ? String(song.override_bpm) : '');
  const [camelot, setCamelot] = useState(song.override_camelot ?? '');
  const [problem, setProblem] = useState('');
  const facts = READINESS[song.readiness.status] ?? READINESS.queued;
  const send = async (body: Record<string, unknown>, said: string) => {
    setProblem('');
    try {
      const answer = await post<{ redone: number }>(`/songs/${song.id}/correct`, body);
      onChanged();
      notify(answer.redone ? `${said} ${answer.redone} transition${answer.redone === 1 ? '' : 's'} with this song will be made again.` : said);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const detectedTempo = song.detected_bpm ? Math.round(song.detected_bpm) : null;
  return (
    <Sheet title={song.title ?? 'Untitled'} onClose={onClose}>
      <p className="song-detail-artist">{song.artist ?? 'Unknown artist'}</p>
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      {song.readiness.reason && <p className="hint">{song.readiness.reason}</p>}
      <dl className="song-facts">
        <div><dt>Length</dt><dd>{clock(song.duration)}</dd></div>
        <div><dt>Tempo</dt><dd>{song.bpm ? `${Math.round(song.bpm)} BPM` : 'Not measured yet'}{song.override_bpm ? ' (your correction)' : ''}</dd></div>
        <div><dt>Key</dt><dd>{song.camelot ?? 'Not measured yet'}{song.override_camelot ? ' (your correction)' : ''}</dd></div>
        <div><dt>Lyrics</dt><dd>{song.lyric_status === 'synced' ? 'Timed' : song.lyric_status === 'instrumental' ? 'Instrumental' : song.lyric_status ? 'Not timed' : 'Not looked up yet'}</dd></div>
        {song.grid_confidence != null && <div><dt>Beat grid</dt><dd>{Math.round(song.grid_confidence * 100)}% sure</dd></div>}
      </dl>
      <section className="stack">
        <h3>Correct it</h3>
        <p className="hint">If Selecta got something wrong. What it measured is kept, so this can be put back, and analysing the song again won’t lose it.</p>
        <div className="row wrap">
          <label className="correct-field">
            Tempo{detectedTempo ? ` (measured ${detectedTempo})` : ''}
            <input type="number" min={40} max={240} step="0.1" value={bpm} onChange={(event) => setBpm(event.target.value)} placeholder={detectedTempo ? String(detectedTempo) : ''} />
          </label>
          {detectedTempo && (
            <>
              <button onClick={() => setBpm(String(Math.round((song.detected_bpm ?? 0) * 2)))}>Double</button>
              <button onClick={() => setBpm(String(Math.round((song.detected_bpm ?? 0) / 2)))}>Half</button>
            </>
          )}
        </div>
        <label className="correct-field">
          Key{song.detected_camelot ? ` (measured ${song.detected_camelot})` : ''}
          <input value={camelot} onChange={(event) => setCamelot(event.target.value.toUpperCase())} placeholder={song.detected_camelot ?? '8A'} maxLength={3} />
        </label>
        {problem && <p className="warn" role="alert">{problem}</p>}
        <div className="row wrap">
          <Action
            className="primary"
            working="Saving…"
            disabled={bpm === (song.override_bpm ? String(song.override_bpm) : '') && camelot === (song.override_camelot ?? '')}
            run={() => send({
              ...(bpm ? { bpm: Number(bpm) } : {}),
              ...(camelot ? { camelot } : {}),
              clear: [...(bpm ? [] : ['bpm']), ...(camelot ? [] : ['camelot'])],
            }, 'Saved your correction.')}
          >
            Save correction
          </Action>
          {(song.override_bpm || song.override_camelot) && (
            <Action run={async () => {
              await send({ clear: ['bpm', 'camelot'] }, 'Back to what Selecta measured.');
              setBpm('');
              setCamelot('');
            }}>
              Use what was measured
            </Action>
          )}
        </div>
      </section>
      <section className="stack">
        <h3>Is it music?</h3>
        <p className="hint">Something set aside never gets analysed or mixed. Your file isn’t touched either way.</p>
        <div className="row wrap">
          {song.readiness.status === 'set_aside' ? (
            <Action run={() => send({ is_music: true }, 'This counts as music now.')}>This is music</Action>
          ) : (
            <Action run={() => send({ is_music: false }, 'Set aside.')}>This isn’t music</Action>
          )}
          {song.music_override != null && <Action run={() => send({ clear: ['is_music'] }, 'Selecta will decide again next time it reads your folder.')}>Let Selecta decide</Action>}
        </div>
      </section>
    </Sheet>
  );
}

export function Library({ mix, now, player, setMixData, setView, notify, status, refreshStatus }: ViewProps) {
  const query = useQueryParam('q') ?? '';
  const filter = useQueryParam('show') ?? 'ready';
  const sort = useQueryParam('sort') ?? 'title';
  const [typed, setTyped] = useState(query);
  const [rows, setRows] = useState<LibrarySong[] | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);
  const line = status.analysing ?? [];
  const asked = useRef(0);

  const url = useCallback((after?: string | null) => {
    const params = new URLSearchParams({ q: query, state: filter, sort, limit: '100' });
    if (after) params.set('after', after);
    return `/library?${params}`;
  }, [query, filter, sort]);

  // only the newest search can answer, however the answers arrive
  const load = useCallback(() => {
    asked.current += 1;
    const mine = asked.current;
    return get<LibraryPage>(url())
      .then((page) => {
        if (mine !== asked.current) return;
        setRows(page.songs);
        setTotal(page.total);
        setNext(page.next);
        setFailed(false);
      })
      .catch(() => { if (mine === asked.current) setFailed(true); });
  }, [url]);

  const more = async () => {
    const mine = asked.current;
    const page = await get<LibraryPage>(url(next));
    if (mine !== asked.current) return;
    setRows((before) => {
      const known = new Set(before?.map((song) => song.id));
      return [...(before ?? []), ...page.songs.filter((song) => !known.has(song.id))];
    });
    setNext(page.next);
    setTotal(page.total);
  };

  // what's on screen keeps its place while it's being brought up to date
  const refreshShown = useCallback(() => {
    const mine = asked.current;
    return get<LibraryPage>(url()).then((page) => {
      if (mine !== asked.current) return;
      setTotal(page.total);
      setRows((before) => {
        if (!before) return page.songs;
        const fresh = new Map(page.songs.map((song) => [song.id, song]));
        return before.map((song) => fresh.get(song.id) ?? song);
      });
    }).catch(() => {});
  }, [url]);

  useEffect(() => {
    const wait = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(wait);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshShown(), line.length ? 4000 : 15000);
    return () => window.clearInterval(timer);
  }, [line.length, refreshShown]);

  useEffect(() => {
    const wait = window.setTimeout(() => setAddressQuery({ q: typed || null }), 200);
    return () => window.clearTimeout(wait);
  }, [typed]);

  const inMix = new Set(mix.map((item) => item.song_id));
  const add = async (song: LibrarySong, position?: number) => {
    setMixData(await post<MixData>('/mix/songs', { song_id: song.id, position }));
    notify(position !== undefined ? `${song.title} plays next.` : `Added ${song.title}.`, true);
  };
  const never = async (song: LibrarySong) => {
    await post(`/songs/${song.id}/never`);
    notify(song.never ? `${song.title} can play again.` : `${song.title} won’t be picked for mixes.`);
    await refreshShown();
  };
  const startFrom = async (song: LibrarySong) => {
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
  const analyse = async (song: LibrarySong) => {
    const { ahead, seconds } = await post<{ ahead: number; seconds?: number }>(`/songs/${song.id}/analyse`);
    refreshStatus();
    notify(askedToAnalyse(song.title, ahead, seconds));
  };
  const setPriority = async (song: LibrarySong) => {
    await post(`/songs/${song.id}/priority?priority=${song.priority ? 0 : 100}`);
    notify(song.priority ? `${song.title} moved to background processing.` : `${song.title} moved to the priority list.`, true);
    await refreshShown();
  };
  const shownDetails = rows?.find((song) => song.id === opened) ?? null;

  return (
    <main className="page library" id="main">
      <h1 className="display small">Library</h1>
      <div className="library-find">
        <input
          className="wide"
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search by artist or title"
          aria-label="Search your library"
        />
        <label className="library-sort">
          Sort by
          <select value={sort} onChange={(event) => setAddressQuery({ sort: event.target.value === 'title' ? null : event.target.value })}>
            {SORTS.map((option) => <option key={option.name} value={option.name}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map((option) => (
          <button key={option.name} aria-pressed={filter === option.name} onClick={() => setAddressQuery({ show: option.name === 'ready' ? null : option.name })}>
            {option.label}
          </button>
        ))}
      </div>
      {filter === 'not_yet' && left > 0 && (
        <div className="row wrap analyse-all">
          <span className="hint">
            {left} song{left === 1 ? '' : 's'} left. {analysisWords(status.eta?.analysis)}
          </span>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <Action run={analyseAll}>Analyse them all</Action>
          )}
        </div>
      )}
      {failed && rows === null && <Problem retry={load}>Couldn’t load your library. Your songs are fine.</Problem>}
      {failed && rows !== null && <p className="warn" role="status">Can’t check on your library right now, so what’s shown may be out of date.</p>}
      {rows === null && !failed && <Skeleton lines={6} label="Loading your songs" />}
      {rows !== null && <p className="hint library-count" role="status">{rows.length < total ? `Showing ${rows.length} of ${total} songs.` : `${total} song${total === 1 ? '' : 's'}.`}</p>}
      {rows?.length === 0 && <p className="lede">{query ? `Nothing matches “${query}”.` : 'Nothing here right now.'}</p>}
      <ul className="rows">
        {rows?.map((song) => {
          const ready = song.bpm !== null;
          const facts = READINESS[song.readiness.status] ?? READINESS.queued;
          const already = inMix.has(song.id);
          return (
            <li key={song.id} className={`song-row ${song.never ? 'never' : ''}`}>
              <div className="song-name">
                <button className="link song-open" onClick={() => setOpened(song.id)} aria-label={`Details for ${song.title ?? 'Untitled'}`}>
                  <b>{song.title ?? 'Untitled'}</b>
                </button>
                <span>{song.artist ?? 'Unknown artist'}</span>
              </div>
              <small className="facts">
                {ready ? `${Math.round(song.bpm!)} BPM ${song.camelot ?? ''}` : 'Not analysed'} · {clock(song.duration)}
                {song.lyric_status === 'synced' ? ' · lyrics' : ''}
              </small>
              <span className="song-readiness" title={song.readiness.reason || undefined}>
                <Status kind={facts.kind}>{facts.words}</Status>
              </span>
              <div className="song-actions">
                {ready ? (
                  <>
                    <Action title="Build a mix that starts here" working="Building your mix…" run={() => startFrom(song)}>Start a mix</Action>
                    <Action working="Adding…" disabled={already} run={() => add(song)}>{already ? 'In the mix' : 'Add'}</Action>
                    {now.phase !== 'idle' && (
                      <Action working="Adding…" disabled={already} run={() => add(song, now.position + 1)}>Play next</Action>
                    )}
                  </>
                ) : (
                  filter !== 'set_aside' && (
                    <Action disabled={line.includes(song.id)} run={() => analyse(song)}>
                      {analysingWords(line, song.id)}
                      {status.eta?.line[song.id] !== undefined && `, ${etaWords(status.eta.line[song.id])}`}
                    </Action>
                  )
                )}
                {filter !== 'set_aside' && (
                  <>
                    <Action
                      aria-pressed={song.priority}
                      run={() => setPriority(song)}
                      title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup"
                    >
                      {song.priority ? 'Priority: on' : 'Prioritize'}
                    </Action>
                    <Action aria-pressed={song.never} run={() => never(song)} title="Selecta won’t pick this when it builds a mix">
                      {song.never ? 'Never: on' : 'Never play'}
                    </Action>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {next && <Action className="library-more" working="Loading…" run={more}>Show more songs</Action>}
      {shownDetails && <SongDetails song={shownDetails} onClose={() => setOpened(null)} onChanged={() => void refreshShown()} notify={notify} />}
    </main>
  );
}
