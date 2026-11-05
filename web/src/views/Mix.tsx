import { useEffect, useRef, useState } from 'react';
import { clock, del, get, length, MixItem, post, SeamOptions, SeamSettings, SongRow } from '../api';
import { VIBES, ViewProps } from './shared';

const SIZES = [8, 12, 20, 40];

/** Build a whole mix in two taps. Locked songs stay exactly where they are. */
export function BuildPanel({ refreshMix, mix, setView }: ViewProps) {
  const [vibe, setVibe] = useState('balanced');
  const [count, setCount] = useState(12);
  const [start, setStart] = useState<SongRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const build = async () => {
    setBusy(true);
    setProblem('');
    try {
      await post('/mix/build', { vibe, count, start: start?.id ?? null });
      refreshMix();
      setView('Mix');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const locked = mix.filter((item) => item.locked).length;

  return (
    <section className="panel stack">
      <fieldset>
        <legend>Feel</legend>
        <div className="chips">
          {VIBES.map((option) => (
            <button key={option.name} aria-pressed={vibe === option.name} onClick={() => setVibe(option.name)}>
              {option.label}
            </button>
          ))}
        </div>
        <p className="hint">{VIBES.find((option) => option.name === vibe)?.hint}</p>
      </fieldset>
      <fieldset>
        <legend>Songs</legend>
        <div className="chips">
          {SIZES.map((size) => (
            <button key={size} aria-pressed={count === size} onClick={() => setCount(size)}>
              {size}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Start with</legend>
        {start ? (
          <p className="row">
            <b>{start.title}</b>
            <span className="soft">{start.artist}</span>
            <button className="link" onClick={() => setStart(null)}>Change</button>
          </p>
        ) : (
          <SongSearch placeholder="Any song, or leave empty" onPick={setStart} />
        )}
      </fieldset>
      <div className="row">
        <button className="primary" onClick={() => void build()} disabled={busy}>
          {busy ? 'Building…' : mix.length ? 'Rebuild the mix' : 'Build my mix'}
        </button>
        {locked > 0 && <span className="hint">{locked} locked {locked === 1 ? 'song stays' : 'songs stay'} put</span>}
      </div>
      {problem && <p className="warn" role="alert">{problem}</p>}
    </section>
  );
}

function SongSearch({ onPick, placeholder }: { onPick: (song: SongRow) => void; placeholder: string }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SongRow[]>([]);
  useEffect(() => {
    if (!query.trim()) {
      setRows([]);
      return;
    }
    const wait = window.setTimeout(() => {
      get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=ready&limit=8`).then(setRows).catch(() => {});
    }, 150);
    return () => window.clearTimeout(wait);
  }, [query]);
  return (
    <div className="search">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label="Search songs"
      />
      {rows.length > 0 && (
        <ul className="results">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                onClick={() => {
                  onPick(row);
                  setQuery('');
                }}
              >
                <b>{row.title}</b> <span>{row.artist}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Preview({ seamKey, seamAt }: { seamKey: string; seamAt: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const start = () => {
    const element = audio.current;
    if (!element) return;
    const go = () => {
      element.currentTime = Math.max(0, seamAt - 8);
      void element.play();
    };
    if (element.readyState > 0) go();
    else element.addEventListener('loadedmetadata', go, { once: true });
  };
  useEffect(start, [seamKey]);
  return <audio ref={audio} controls src={`/api/seams/${seamKey}/preview`} className="preview" />;
}

function SeamEditor({ position, item, refreshMix }: { position: number; item: MixItem; refreshMix: () => void }) {
  const [options, setOptions] = useState<SeamOptions | null>(null);
  const [problem, setProblem] = useState('');
  const settings: SeamSettings = item.seam?.settings ?? {};
  const chosen = settings.move ?? 'auto';

  useEffect(() => {
    let live = true;
    setOptions(null);
    get<SeamOptions>(`/mix/${position}/options`)
      .then((data) => live && setOptions(data))
      .catch((error: Error) => live && setProblem(error.message));
    return () => {
      live = false;
    };
  }, [position, item.song_id]);

  const change = async (changes: SeamSettings) => {
    setProblem('');
    try {
      await post(`/mix/${position}/seam`, { ...settings, ...changes });
      await post(`/mix/${position}/render`);
      refreshMix();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  if (problem && !options) return <p className="warn">{problem}</p>;
  if (!options) return <p className="hint">Working out what’s possible…</p>;

  const move = options.moves.find((option) => option.name === chosen);
  const usesBars = ['bass_swap_blend', 'filter_sweep', 'vocal_ride', 'word_blend'].includes(chosen);
  const usesCues = ['bass_swap_blend', 'filter_sweep', 'tempo_ramp', 'cut_on_one', 'echo_out', 'delay_throw', 'reverb_wash'].includes(chosen);
  const usesPhrase = ['word_blend', 'word_exchange', 'phrase_roll', 'word_cut'].includes(chosen);
  return (
    <div className="editor stack">
      <fieldset>
        <legend>How should this land?</legend>
        <div className="chips moves">
          {options.moves.map((option) => (
            <button
              key={option.name}
              aria-pressed={chosen === option.name}
              disabled={!option.available}
              title={option.reason ?? option.description}
              onClick={() => void change({ move: option.name, bars: undefined, phrase: undefined, exit_bar: undefined, entry_bar: undefined })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="hint">{move?.description}</p>
        <p className="hint">{options.tempo_gap}% tempo gap, keys {options.keys.join(' and ')}.</p>
        {options.moves.some((option) => !option.available) && (
          <details className="why-not">
            <summary>Why some moves are greyed out</summary>
            <ul>
              {options.moves
                .filter((option) => !option.available)
                .map((option) => (
                  <li key={option.name}>
                    <b>{option.label}:</b> {option.reason}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </fieldset>

      {usesBars && (
        <fieldset>
          <legend>{chosen === 'bass_swap_blend' || chosen === 'filter_sweep' ? 'Overlap' : 'How long B’s band plays under A’s voice'}</legend>
          <div className="chips">
            {[4, 8, 16].map((bars) => (
              <button key={bars} aria-pressed={settings.bars === bars} onClick={() => void change({ bars })}>
                {bars} bars
              </button>
            ))}
            <button aria-pressed={settings.bars === undefined} onClick={() => void change({ bars: undefined })}>
              Pick for me
            </button>
          </div>
        </fieldset>
      )}

      {usesCues && (
        <div className="cue-row">
          <label>
            Leave <b>this song</b>
            <select
              value={settings.exit_bar ?? ''}
              onChange={(event) => void change({ exit_bar: event.target.value ? Number(event.target.value) : undefined })}
            >
              <option value="">Wherever’s best</option>
              {options.exits.map((cue) => (
                <option key={cue.bar} value={cue.bar}>
                  {clock(cue.time)}, {cue.kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bring in <b>{item.title}</b>
            <select
              value={settings.entry_bar ?? ''}
              onChange={(event) => void change({ entry_bar: event.target.value ? Number(event.target.value) : undefined })}
            >
              <option value="">Wherever’s best</option>
              {options.entries.map((cue) => (
                <option key={cue.bar} value={cue.bar}>
                  {clock(cue.time)}, {cue.kind}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {usesPhrase && options.links.length > 1 && (
        <fieldset>
          <legend>Which phrase</legend>
          <div className="chips">
            {options.links.map((link) => (
              <button
                key={link.phrase}
                aria-pressed={(settings.phrase ?? options.links[0].phrase) === link.phrase}
                title={`“${link.line_a}” into “${link.line_b}”`}
                onClick={() => void change({ phrase: link.phrase })}
              >
                {link.phrase}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
    </div>
  );
}

function SeamRow({ item, refreshMix, open, onToggle }: { item: MixItem; refreshMix: () => void; open: boolean; onToggle: () => void }) {
  const seam = item.seam!;
  const state = seam.state;
  const chosen = seam.settings.move ?? 'auto';
  const [hearing, setHearing] = useState(false);
  const label = state.label && (chosen === 'auto' || state.style === chosen) ? state.label : undefined;

  const hear = async () => {
    setHearing(true);
    if (state.status !== 'ready') {
      await post(`/mix/${item.position}/render`);
      refreshMix();
    }
  };
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    refreshMix();
  };

  const pill =
    state.status === 'ready'
      ? state.passed
        ? 'Ready'
        : 'Ready, with a warning'
      : state.status === 'failed'
        ? 'Can’t do this one'
        : state.status === 'none'
          ? 'Not rendered yet'
          : state.status === 'queued'
            ? 'Waiting to render'
            : 'Rendering…';

  return (
    <li className={`seam ${open ? 'open' : ''}`}>
      <div className="seam-line">
        <button className="seam-name" onClick={onToggle} aria-expanded={open}>
          <b>{label ?? (chosen === 'auto' ? 'Let Selecta pick' : chosen.replace(/_/g, ' '))}</b>
          <span className={`pill ${state.status} ${state.status === 'ready' && !state.passed ? 'warned' : ''}`}>{pill}</span>
        </button>
        <div className="seam-actions">
          <button onClick={() => void hear()} disabled={state.status === 'queued' || state.status === 'rendering'}>
            {state.status === 'ready' ? 'Hear it' : 'Render & hear'}
          </button>
          {state.status === 'ready' && (
            <span className="pair" role="group" aria-label="Rate this seam">
              <button aria-pressed={state.rating === 'good'} onClick={() => void rate('good')}>Good</button>
              <button aria-pressed={state.rating === 'bad'} onClick={() => void rate('bad')}>Bad</button>
            </span>
          )}
          <button onClick={onToggle}>{open ? 'Close' : 'Change'}</button>
        </div>
      </div>
      {state.status === 'failed' && <p className="warn">{state.error}</p>}
      {hearing && state.status === 'ready' && <Preview seamKey={state.key} seamAt={state.preview_seam ?? 0} />}
      {open && state.status === 'ready' && (
        <div className="report">
          {state.why && <p className="hint">{state.why}.</p>}
          {state.fell_back && <p className="warn">Nothing cleared the bar here, so this is the safe echo.</p>}
          <ul>
            {state.checks?.map((check) => (
              <li key={check.name} className={check.passed ? 'ok' : 'bad'}>
                {check.passed ? '✓' : '!'} {check.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <SeamEditor position={item.position} item={item} refreshMix={refreshMix} />}
    </li>
  );
}

function SongLine(props: {
  item: MixItem;
  total: number;
  refreshMix: () => void;
  onPlay: () => void;
  onDrop: (from: number, to: number) => void;
  playing: boolean;
}) {
  const { item, total, refreshMix, onPlay, onDrop, playing } = props;
  const [over, setOver] = useState(false);
  const act = async (call: Promise<unknown>) => {
    await call;
    refreshMix();
  };
  return (
    <li
      className={`song ${over ? 'over' : ''} ${playing ? 'playing' : ''}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.position))}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop(Number(event.dataTransfer.getData('text/plain')), item.position);
      }}
    >
      <span className="grip" aria-hidden="true">⠿</span>
      <span className="count">{item.position + 1}</span>
      <div className="song-name">
        <b>{item.title}</b>
        <span>{item.artist}</span>
      </div>
      <small className="facts">
        {item.bpm ? `${Math.round(item.bpm)} BPM` : ''} {item.key ?? ''} · {clock(item.duration)}
      </small>
      <div className="song-actions">
        <button onClick={onPlay} aria-label={`Play from ${item.title}`}>Play</button>
        <button
          aria-label={`Move ${item.title} up`}
          disabled={item.position === 0}
          onClick={() => void act(post('/mix/move', { source: item.position, target: item.position - 1 }))}
        >
          ↑
        </button>
        <button
          aria-label={`Move ${item.title} down`}
          disabled={item.position === total - 1}
          onClick={() => void act(post('/mix/move', { source: item.position, target: item.position + 1 }))}
        >
          ↓
        </button>
        <button
          aria-pressed={item.locked}
          title="A locked song stays here when the mix is rebuilt"
          onClick={() => void act(post(`/mix/${item.position}/lock`))}
        >
          {item.locked ? 'Locked' : 'Lock'}
        </button>
        <button aria-label={`Remove ${item.title}`} onClick={() => void act(del(`/mix/songs/${item.position}`))}>
          ✕
        </button>
      </div>
    </li>
  );
}

export function Mix(props: ViewProps) {
  const { mix, refreshMix, player, now, setView } = props;
  const [openSeam, setOpenSeam] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [exported, setExported] = useState<{ name: string; seconds: number } | null>(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const total = mix.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const seams = mix.slice(1).map((item) => item.seam!.state);
  const ready = seams.filter((state) => state.status === 'ready').length;

  const addSong = async (song: SongRow, position: number) => {
    await post('/mix/songs', { song_id: song.id, position });
    setAdding(null);
    refreshMix();
  };

  const renderAll = async () => {
    setProblem('');
    for (const item of mix.slice(1)) {
      if (item.seam!.state.status === 'none' || item.seam!.state.status === 'failed') {
        await post(`/mix/${item.position}/render`);
      }
    }
    refreshMix();
  };

  const save = async () => {
    setProblem('');
    setSaving(true);
    try {
      setExported(await post<{ name: string; seconds: number }>('/mix/export'));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    player.stop();
    await post('/mix/clear');
    refreshMix();
  };

  return (
    <main className="page mix">
      <header className="mix-head">
        <div>
          <h1 className="display small">Your mix</h1>
          <p className="lede">
            {mix.length
              ? `${mix.length} songs, about ${length(total * 0.8)}. Tap any seam to change how it lands. ${seams.length ? `${ready} of ${seams.length} seams are ready.` : ''}`
              : 'Nothing here yet.'}
          </p>
        </div>
        <div className="row wrap">
          {mix.length > 0 && (
            <button className="primary" onClick={() => void player.playFrom(0)}>
              Play from the top
            </button>
          )}
          <button onClick={() => setBuilding(!building)} aria-expanded={building}>
            {mix.length ? 'Rebuild' : 'Build a mix'}
          </button>
          <button onClick={() => setView('Library')}>Add songs</button>
          {mix.length > 1 && ready < seams.length && <button onClick={() => void renderAll()}>Render every seam</button>}
          {mix.length > 1 && (
            <button onClick={() => void save()} disabled={ready < seams.length || saving} title={ready < seams.length ? 'Every seam has to be rendered first' : ''}>
              {saving ? 'Saving…' : 'Save as a file'}
            </button>
          )}
          {mix.length > 0 && <button onClick={() => void clear()}>Clear</button>}
        </div>
      </header>
      {problem && <p className="warn" role="alert">{problem}</p>}
      {exported && (
        <p className="notice" role="status">
          Saved {length(exported.seconds)}: <a href={`/api/exports/${exported.name}`}>download {exported.name}</a>
        </p>
      )}
      {(building || !mix.length) && <BuildPanel {...props} />}

      <ol className="timeline">
        {mix.map((item, index) => (
          <FragmentRow key={`${item.song_id}-${index}`}>
            {index > 0 && (
              <SeamRow
                item={item}
                refreshMix={refreshMix}
                open={openSeam === index}
                onToggle={() => setOpenSeam(openSeam === index ? null : index)}
              />
            )}
            <SongLine
              item={item}
              total={mix.length}
              refreshMix={refreshMix}
              playing={now.phase !== 'idle' && now.position === index}
              onPlay={() => void player.playFrom(index)}
              onDrop={(from, to) => {
                if (from !== to) void post('/mix/move', { source: from, target: to }).then(refreshMix);
              }}
            />
            {adding === index + 1 ? (
              <li className="adder">
                <SongSearch placeholder="Search for a song to add here" onPick={(song) => void addSong(song, index + 1)} />
                <button onClick={() => setAdding(null)}>Cancel</button>
              </li>
            ) : (
              <li className="add-gap">
                <button onClick={() => setAdding(index + 1)} aria-label={`Add a song after ${item.title}`}>+</button>
              </li>
            )}
          </FragmentRow>
        ))}
      </ol>
    </main>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
