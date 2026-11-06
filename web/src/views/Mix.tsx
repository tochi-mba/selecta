import { FormEvent, KeyboardEvent, useContext, useEffect, useRef, useState } from 'react';
import { del, DraftList, get, MixData, MixItem, post, SeamOptions, SeamSettings, Suggestion } from '../api';
import { analysingWords, askedToAnalyse, clock, etaRangeWords, etaWords, length, nth, runningTime, seamStatusWords, triedWords } from '../lib';
import { RenameDraft } from './Drafts';
import { MixScope, useMixPath } from './mixScope';
import { Studio } from './Studio';
import { Undo, ViewProps } from './shared';

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
              <button disabled={line.includes(song.song_id)} onClick={() => void analyse(song)}>
                {analysingWords(line, song.song_id)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ seamKey, seamAt }: { seamKey: string; seamAt: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const go = () => {
      element.currentTime = Math.max(0, seamAt - 8);
      void element.play().catch(() => {});
    };
    if (element.readyState > 0) go();
    else element.addEventListener('loadedmetadata', go, { once: true });
  }, [seamKey, seamAt]);
  return <audio ref={audio} controls src={`/api/seams/${seamKey}/preview`} className="preview" />;
}

function SeamEditor(props: {
  position: number;
  item: MixItem;
  previous: MixItem;
  refreshMix: () => void;
  notify: (message: string, undo?: Undo) => void;
  onListen?: () => void;
}) {
  const { position, item, previous, refreshMix, notify, onListen } = props;
  const [options, setOptions] = useState<SeamOptions | null>(null);
  const [problem, setProblem] = useState('');
  const [studio, setStudio] = useState(false);
  const at = useMixPath();
  const settings: SeamSettings = item.seam?.settings ?? {};
  const planned = settings.move ?? 'auto';
  const state = item.seam?.state;
  // once a seam has rendered, the move to show is the one you're hearing, even if another was planned
  const chosen = state?.status === 'ready' && state.style ? state.style : planned;

  useEffect(() => {
    let live = true;
    setOptions(null);
    get<SeamOptions>(at(`/mix/${position}/options`))
      .then((data) => live && setOptions(data))
      .catch((error: Error) => live && setProblem(error.message));
    return () => {
      live = false;
    };
  }, [position, item.song_id, previous.song_id]);

  const change = async (changes: SeamSettings) => {
    setProblem('');
    try {
      // anything the person picks is their choice, so it stops being Selecta's to replace
      await post(at(`/mix/${position}/seam`), { ...settings, ...changes, soft: false });
      await post(at(`/mix/${position}/render`));
      refreshMix();
      notify('Changed that seam. Rendering it now.', true);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  if (problem && !options) return <p className="warn">{problem}</p>;
  if (!options) return <p className="hint">Working out what’s possible…</p>;
  if (studio) {
    return (
      <Studio
        position={position}
        item={item}
        previous={previous}
        onClose={() => setStudio(false)}
        onUsed={() => refreshMix()}
        onListen={onListen}
        notify={notify}
      />
    );
  }

  const move = options.moves.find((option) => option.name === chosen);
  const blends = ['bass_swap_blend', 'filter_sweep'].includes(chosen);
  const rides = ['vocal_ride', 'word_blend', 'word_exchange'].includes(chosen);
  const usesCues = ['bass_swap_blend', 'filter_sweep', 'tempo_ramp', 'cut_on_one', 'echo_out', 'delay_throw', 'reverb_wash'].includes(chosen);
  const usesPhrase = ['word_blend', 'word_exchange', 'phrase_roll', 'word_cut'].includes(chosen);
  const off = options.moves.filter((option) => !option.available);
  return (
    <div className="editor stack">
      {options.studio && (
        <div className="row wrap">
          <button disabled={!options.studio.available} onClick={() => setStudio(true)}>
            Shape it yourself with stems
          </button>
          {!options.studio.available && <span className="hint">{options.studio.reason}</span>}
        </div>
      )}
      {chosen === 'stem_studio' && <p className="hint">You shaped this one in the studio.</p>}
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
        {off.length > 0 && (
          <details className="why-not">
            <summary>Why {off.length === 1 ? 'one move is' : `${off.length} moves are`} greyed out</summary>
            <ul>
              {off.map((option) => (
                <li key={option.name}>
                  <b>{option.label}:</b> {option.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </fieldset>

      {(blends || rides) && (
        <fieldset>
          <legend>{blends ? 'How long they overlap' : 'How long B’s band plays under A’s voice'}</legend>
          <div className="chips">
            <button aria-pressed={settings.bars === undefined} onClick={() => void change({ bars: undefined })}>
              Pick for me
            </button>
            {(blends ? [4, 8, 16] : [4, 8, 12, 16]).map((bars) => (
              <button key={bars} aria-pressed={settings.bars === bars} onClick={() => void change({ bars })}>
                {bars} bars
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {usesCues && (
        <div className="cue-row">
          <label>
            Leave <b>{previous.title}</b> at
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
            Bring in <b>{item.title}</b> at
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

function SeamRow(props: {
  item: MixItem;
  previous: MixItem;
  refreshMix: () => void;
  open: boolean;
  onToggle: () => void;
  names: Record<string, string>;
  notify: (message: string, undo?: Undo) => void;
  onListen?: () => void;
}) {
  const { item, previous, refreshMix, open, onToggle, names, notify, onListen } = props;
  const seam = item.seam!;
  const state = seam.state;
  const plannedBars = state.bars ?? seam.settings.bars;
  const chosen = seam.settings.move ?? 'auto';
  const [hearing, setHearing] = useState(false);
  const at = useMixPath();
  const busy = state.status === 'queued' || state.status === 'rendering';
  const label = state.status === 'ready' ? (state.label ?? names[chosen]) : (names[chosen] ?? chosen);

  const hear = async () => {
    setHearing(!hearing || state.status !== 'ready');
    if (state.status !== 'ready') {
      await post(at(`/mix/${item.position}/render`));
      refreshMix();
    }
  };
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    refreshMix();
  };

  return (
    <li className={`seam ${open ? 'open' : ''}`}>
      <div className="seam-line">
        <button className="seam-name" onClick={onToggle} aria-expanded={open}>
          <b>{label}</b>
          <span className={`pill ${state.status} ${state.status === 'ready' && !state.passed ? 'warned' : ''}`}>
            {seamStatusWords(state.status, state.passed)}
            {state.eta !== undefined && `, ${etaWords(state.eta)}`}
          </span>
        </button>
        <div className="seam-actions">
          {!busy && state.status !== 'failed' && (
            <button onClick={() => void hear()}>
              {state.status === 'ready' ? (hearing ? 'Hide' : 'Hear it') : 'Render and hear'}
            </button>
          )}
          {state.status === 'ready' && (
            <span className="pair" role="group" aria-label="Rate this seam">
              <button aria-pressed={state.rating === 'good'} onClick={() => void rate('good')}>Good</button>
              <button aria-pressed={state.rating === 'bad'} onClick={() => void rate('bad')}>Bad</button>
            </span>
          )}
          <button onClick={onToggle}>{open ? 'Close' : 'Change'}</button>
        </div>
      </div>
      <div className={`seam-visual ${state.status}`} role="img" aria-label={`${state.status === 'ready' ? 'Ready' : 'Planned'} transition${plannedBars ? ` over ${plannedBars} bars` : '; length not yet determined'} from ${previous.title} into ${item.title}`}>
        <span className="seam-visual-label">{state.status === 'ready' ? 'Transition' : 'Transition plan'} · {plannedBars ? `${plannedBars} bars` : 'Length pending'}</span>
        <div className="seam-visual-bars" aria-hidden="true">
          {Array.from({ length: plannedBars ? Math.min(Math.max(plannedBars, 1), 8) : 1 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <span className="seam-visual-caption"><b>{previous.title}</b><span>→</span><b>{item.title}</b></span>
      </div>
      {state.status === 'failed' && (
        <p className="warn">
          Remembered failed attempt: {state.error} {!open && <button className="link" onClick={onToggle}>Try another move</button>}
          <button className="link" onClick={() => void post(at(`/mix/${item.position}/render?retry=true`)).then(refreshMix)}>Retry this attempt anyway</button>
        </p>
      )}
      {hearing && state.status === 'ready' && <Preview seamKey={state.key} seamAt={state.preview_seam ?? 0} />}
      {open && state.status === 'ready' && (
        <div className="report">
          {state.why && <p className="hint">{state.why}.</p>}
          {triedWords(state.tried ?? [], names).map((line) => (
            <p className="hint" key={line}>
              {line}
            </p>
          ))}
          <ul>
            {state.checks?.map((check) => (
              <li key={check.name} className={check.passed ? 'ok' : 'bad'}>
                {check.passed ? '✓' : '!'} {check.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <SeamEditor position={item.position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} onListen={onListen} />}
    </li>
  );
}

function SongLine(props: {
  item: MixItem;
  total: number;
  setMixData: (data: MixData) => void;
  onPlay: () => void;
  onDrop: (from: number, to: number) => void;
  playing: boolean;
  notify: (message: string, undo?: Undo) => void;
}) {
  const { item, total, setMixData, onPlay, onDrop, playing, notify } = props;
  const [over, setOver] = useState(false);
  const at = useMixPath();
  const act = async (call: Promise<MixData>, message?: string) => {
    setMixData(await call);
    if (message) notify(message, true);
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
      <span className="grip" aria-hidden="true" title="Drag to move">⠿</span>
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
          onClick={() => void act(post<MixData>(at('/mix/move'), { source: item.position, target: item.position - 1 }), `Moved ${item.title} up.`)}
        >
          ↑
        </button>
        <button
          aria-label={`Move ${item.title} down`}
          disabled={item.position === total - 1}
          onClick={() => void act(post<MixData>(at('/mix/move'), { source: item.position, target: item.position + 1 }), `Moved ${item.title} down.`)}
        >
          ↓
        </button>
        <button
          aria-pressed={item.locked}
          title="A locked song stays right here when the mix is rebuilt"
          onClick={() => void act(post<MixData>(at(`/mix/${item.position}/lock`)))}
        >
          {item.locked ? 'Locked' : 'Lock'}
        </button>
        <button aria-label={`Remove ${item.title}`} onClick={() => void act(del<MixData>(at(`/mix/songs/${item.position}`)), `Removed ${item.title}.`)}>
          ✕
        </button>
      </div>
    </li>
  );
}

export function Mix(props: ViewProps) {
  const { mix, mixName, refreshMix, setMixData, player, now, setView, notify, status, refreshStatus, mixEta, draftPlace, openDraft, closeDraft, playDraft, renamedDraft } = props;
  const draftId = useContext(MixScope);
  const inDraft = draftId !== null;
  const at = useMixPath();
  const line = status.analysing ?? [];
  const [openSeam, setOpenSeam] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(inDraft && !mix.length ? 0 : null);
  const [renaming, setRenaming] = useState(false);
  const [wantFile, setWantFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exported, setExported] = useState<{ name: string; seconds: number } | null>(null);
  const [problem, setProblem] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(mixName);

  const total = runningTime(mix);
  const seams = mix.slice(1).map((item) => item.seam!.state);
  const ready = seams.filter((state) => state.status === 'ready').length;
  const failed = seams.filter((state) => state.status === 'failed').length;

  const addSong = async (song: Suggestion, position: number) => {
    setMixData(await post<MixData>(at('/mix/songs'), { song_id: song.song_id, position }));
    setAdding(null);
    notify(`Added ${song.title}.`, true);
  };

  const waiting = seams.filter((state) => state.status === 'none').length;
  const rendering = seams.filter((state) => state.status === 'queued' || state.status === 'rendering').length;

  const renderAll = async () => {
    setMixData(await post<MixData>(at('/mix/render')));
    notify(`Rendering ${waiting} seam${waiting === 1 ? '' : 's'}, in order, ahead of everything else.`);
  };

  const download = async () => {
    setProblem('');
    setExported(null);
    setWantFile(true);
    setMixData(await post<MixData>(at('/mix/render')));
  };

  // Downloading renders whatever isn't ready, then saves the file by itself.
  useEffect(() => {
    if (!wantFile || saving) return;
    if (ready < seams.length) {
      const stuck = seams.every((state) => state.status === 'ready' || state.status === 'failed');
      if (failed && stuck) {
        setWantFile(false);
        setProblem(`${failed} seam${failed === 1 ? '' : 's'} couldn’t be made. Pick another move for ${failed === 1 ? 'it' : 'them'}, then try again.`);
      }
      return;
    }
    setSaving(true);
    post<{ name: string; seconds: number }>(at('/mix/export'))
      .then(setExported)
      .catch((error: Error) => setProblem(error.message))
      .finally(() => {
        setSaving(false);
        setWantFile(false);
      });
  }, [wantFile, ready, failed, seams.length, saving]);

  const saveMix = async (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    const made = await post<{ name: string }>('/drafts', { name: clean, copy_current: true });
    setNaming(false);
    notify(`Saved a copy as a draft: ${made.name}. It’s on the Mixes page.`);
  };

  const prioritize = async (take: boolean) => {
    const next = await (take ? post<DraftList>(`/drafts/${draftId}/line`) : del<DraftList>(`/drafts/${draftId}/line`));
    refreshMix();
    const placed = next.drafts.find((item) => item.id === draftId);
    if (!take) notify('Taken out of the line. It won’t render by itself now.');
    else if (placed?.place) {
      notify(placed.place === 1 && next.current.left === 0 ? 'Rendering this in the background.' : `This will render after what’s ahead of it, in ${etaRangeWords(placed.eta ?? undefined)}.`);
    }
  };
  const copyDraft = async () => {
    const made = await post<{ name: string }>(`/drafts/${draftId}/duplicate`);
    notify(`Made a copy: ${made.name}.`);
  };
  const deleteDraft = async () => {
    const gone = await del<{ name: string }>(`/drafts/${draftId}`);
    closeDraft?.();
    setView('Mixes');
    notify(`Deleted ${gone.name}.`, async () => {
      const back = await post<{ id: number }>('/drafts/restore');
      openDraft?.(back.id);
    });
  };
  const renameForm = renaming && inDraft && (
    <RenameDraft
      id={draftId}
      name={mixName}
      onDone={(name) => {
        renamedDraft?.(name);
        setRenaming(false);
      }}
    />
  );
  const backToCurrent = () => {
    closeDraft?.();
    setView('Edit');
  };

  const clear = async () => {
    player.stop();
    setMixData(await post<MixData>('/mix/clear'));
    notify('Cleared the mix.', true);
  };

  if (!mix.length && inDraft) {
    return (
      <main className="page mix">
        <MixSwitcher draftId={draftId} openDraft={openDraft} closeDraft={backToCurrent} />
        <p className="eyebrow">Draft</p>
        <h1 className="display small">{mixName}</h1>
        <p className="lede">Add the first song. Nothing here touches what’s playing.</p>
        <div className="row wrap">
          <button onClick={() => setAdding(0)}>Add a song</button>
          <button onClick={() => setRenaming(true)}>Rename</button>
          <button onClick={() => void deleteDraft()}>Delete</button>
          <button onClick={backToCurrent}>Back to current mix</button>
        </div>
        {renameForm}
        {adding === 0 && (
          <Adder position={0} onAdd={(song) => void addSong(song, 0)} onClose={() => setAdding(null)} notify={notify} line={line} refreshStatus={refreshStatus} />
        )}
      </main>
    );
  }

  if (!mix.length) {
    return (
      <main className="page">
        <h1 className="display small">Nothing here yet</h1>
        <p className="lede">Start from one of Selecta’s mixes, or add songs yourself.</p>
        <div className="row wrap">
          <button className="primary" onClick={() => setView('Mixes')}>See the mixes</button>
          <button onClick={() => setAdding(0)}>Add a song</button>
        </div>
        {adding === 0 && (
          <Adder position={0} onAdd={(song) => void addSong(song, 0)} onClose={() => setAdding(null)} notify={notify} line={line} refreshStatus={refreshStatus} />
        )}
      </main>
    );
  }

  return (
    <main className="page mix">
      <header className="mix-head">
        <div>
          <MixSwitcher draftId={draftId} openDraft={openDraft} closeDraft={backToCurrent} />
          {inDraft && <p className="eyebrow">Draft</p>}
          <h1 className="display small">{mixName}</h1>
          <p className="lede">
            {mix.length} {mix.length === 1 ? 'song' : 'songs'}, about {length(total)}.
            {seams.length > 0 && ` ${ready} of ${seams.length} seams are ready.`}
            {!inDraft && mixEta && mixEta.seams > 0 && ` The rest take ${etaRangeWords(mixEta)}.`}
            {inDraft && mixEta && mixEta.seams > 0 && (draftPlace
              ? ` ${nth(draftPlace)} in line. All ready in ${etaRangeWords(mixEta)}.`
              : ` Prioritize it and all of it would be ready in ${etaRangeWords(mixEta)}.`)}
            {seams.length > 0 && ' Tap any seam to change how it lands.'}
          </p>
          {inDraft && <p className="hint">Saved as you go. What’s playing isn’t affected.</p>}
        </div>
        <div className="row wrap">
          {inDraft ? (
            <>
              <button className="primary" onClick={() => void playDraft?.(draftId)}>Play this mix</button>
              {draftPlace ? (
                <button onClick={() => void prioritize(false)}>Take out of line</button>
              ) : (
                waiting > 0 && (
                  <button title="Renders in the background, right after your current mix" onClick={() => void prioritize(true)}>
                    Prioritize
                  </button>
                )
              )}
              <button onClick={() => setRenaming(true)}>Rename</button>
              <button onClick={() => void copyDraft()}>Copy</button>
            </>
          ) : (
            <>
          <button className="primary" onClick={() => {
            setView('Now');
            void player.playFrom(0);
          }}>
            Play from the top
          </button>
          <button onClick={() => {
            setName(mixName);
            setNaming(!naming);
          }} aria-expanded={naming}>
            Save a copy
          </button>
            </>
          )}
          {!inDraft && ready < seams.length && (
            <button onClick={() => void renderAll()} disabled={!waiting}>
              {waiting ? 'Render every seam' : rendering ? `Rendering ${ready} of ${seams.length}…` : 'Change failed transitions to continue'}
            </button>
          )}
          {mix.length > 1 && (
            <button onClick={() => void download()} disabled={wantFile}>
              {saving ? 'Saving file…' : wantFile ? `Rendering ${ready} of ${seams.length}…` : 'Download audio'}
            </button>
          )}
          {inDraft ? (
            <>
              <button onClick={() => void deleteDraft()}>Delete</button>
              <button onClick={backToCurrent}>Back to current mix</button>
            </>
          ) : (
            <>
              <button onClick={() => setView('Mixes')}>New mix</button>
              <button onClick={() => void clear()}>Clear</button>
            </>
          )}
        </div>
      </header>
      {renameForm}
      {naming && (
        <form className="row" onSubmit={saveMix}>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Name this mix" />
          <button className="primary" disabled={!name.trim()}>Save copy</button>
          <button type="button" onClick={() => setNaming(false)}>Cancel</button>
        </form>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {exported && (
        <p className="notice" role="status">
          Ready, {length(exported.seconds)} long: <a href={`/api/exports/${exported.name}`} download>download {exported.name}</a>
        </p>
      )}

      <ol className="timeline">
        {mix.map((item, index) => (
          <FragmentRow key={`${item.song_id}-${index}`}>
            {index > 0 && (
              <SeamRow
                item={item}
                previous={mix[index - 1]}
                refreshMix={refreshMix}
                names={status.moves}
                notify={notify}
                open={openSeam === index}
                onToggle={() => setOpenSeam(openSeam === index ? null : index)}
                onListen={() => {
                  if (now.phase === 'playing') void player.togglePause();
                }}
              />
            )}
            <SongLine
              item={item}
              total={mix.length}
              setMixData={setMixData}
              notify={notify}
              playing={!inDraft && now.phase !== 'idle' && now.position === index}
              onPlay={() => {
                if (inDraft) {
                  void playDraft?.(draftId, index);
                  return;
                }
                setView('Now');
                void player.playFrom(index);
              }}
              onDrop={(from, to) => {
                if (from !== to) {
                  void post<MixData>(at('/mix/move'), { source: from, target: to }).then((data) => {
                    setMixData(data);
                    notify('Moved that song.', true);
                  });
                }
              }}
            />
            {adding === index + 1 ? (
              <li className="adder-row">
                <Adder
                  position={index + 1}
                  onAdd={(song) => void addSong(song, index + 1)}
                  onClose={() => setAdding(null)}
                  notify={notify}
                  line={line}
                  refreshStatus={refreshStatus}
                />
              </li>
            ) : (
              <li className="add-gap">
                <button onClick={() => setAdding(index + 1)} aria-label={`Add a song after ${item.title}`} title="Add a song here">
                  +
                </button>
              </li>
            )}
          </FragmentRow>
        ))}
      </ol>
    </main>
  );
}

/** Which mix is being edited, for as soon as there's more than one. */
function MixSwitcher({ draftId, openDraft, closeDraft }: { draftId: number | null; openDraft?: (id: number) => void; closeDraft: () => void }) {
  const [list, setList] = useState<DraftList | null>(null);
  useEffect(() => {
    get<DraftList>('/drafts').then(setList).catch(() => {});
  }, [draftId]);
  if (!list || !list.drafts.length) return null;
  return (
    <label className="switcher">
      Editing
      <select
        value={draftId ?? 'current'}
        onChange={(event) => {
          if (event.target.value === 'current') closeDraft();
          else openDraft?.(Number(event.target.value));
        }}
      >
        <option value="current">Current mix: {list.current.name}</option>
        {list.drafts.map((draft) => (
          <option key={draft.id} value={draft.id}>Draft: {draft.name}</option>
        ))}
      </select>
    </label>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
