import { DragEvent, FormEvent, KeyboardEvent, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, del, DraftList, get, MixData, MixItem, post, SeamOptions, SeamSettings, Suggestion } from '../api';
import { PageLink } from '../shell/Shell';
import { AudioPreview } from '../ui/AudioPreview';
import { Action, Dialog, Sheet, Status, Workspace } from '../ui/controls';
import { seamFacts } from '../ui/seam';
import { analysingWords, askedToAnalyse, clock, etaRangeWords, etaWords, length, nth, runningTime, seamStatusWords, triedWords } from '../lib';
import { RenameDraft } from './Drafts';
import { MixScope, useMixPath } from './mixScope';
import { ComingSongs, RequestTag, useRequestComing } from './Requests';
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

function SeamEditor(props: {
  position: number;
  item: MixItem;
  previous: MixItem;
  refreshMix: () => void;
  notify: (message: string, undo?: Undo) => void;
  onListen?: () => void;
  guard: Record<string, string>;
  studioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
}) {
  const { position, item, previous, refreshMix, notify, onListen, guard, studioOpen: studio, setStudioOpen: setStudio } = props;
  const [options, setOptions] = useState<SeamOptions | null>(null);
  const [problem, setProblem] = useState('');
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
      await post(at(`/mix/${position}/seam`), { ...settings, ...changes, soft: false }, guard);
      await post(at(`/mix/${position}/render`), undefined, guard);
      refreshMix();
      notify('Changed that seam. Rendering it now.', true);
    } catch (error) {
      setProblem((error as Error).message);
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
    }
  };

  if (problem && !options) return <p className="warn">{problem}</p>;
  if (!options) return <p className="hint">Working out what’s possible…</p>;
  if (studio) {
    return (
      <Workspace title={`${previous.title} into ${item.title}`} onClose={() => setStudio(false)}>
        <Studio
          position={position}
          item={item}
          previous={previous}
          onClose={() => setStudio(false)}
          onUsed={() => refreshMix()}
          onListen={onListen}
          notify={notify}
          guard={guard}
        />
      </Workspace>
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
      {chosen === 'stem_studio' && <p className="hint">You shaped this one in the studio.</p>}
      {chosen === 'stem_arrange' && (
        <p className="hint">Selecta built this from what’s in the stems, and learns from every one you rate. Open the grid to see or change it.</p>
      )}
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

/** A seam a request is about to replace isn't shown, because the request's own transitions are
 * there in its place. If the request is cancelled, this comes back. */
function SeamUnlessReplaced(props: Parameters<typeof SeamRow>[0] & { inDraft: boolean }) {
  const { inDraft, ...row } = props;
  const replaced = useRequestComing(row.previous.song_id);
  return !inDraft && replaced ? null : <SeamRow {...row} />;
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
  onHear?: () => void;
  guard?: Record<string, string>;
}) {
  const { item, previous, refreshMix, open, onToggle, names, onHear } = props;
  const seam = item.seam!;
  const state = seam.state;
  const plannedBars = state.bars ?? seam.settings.bars;
  const chosen = seam.settings.move ?? 'auto';
  const at = useMixPath();
  const label = state.status === 'ready' ? (state.label ?? names[chosen]) : (names[chosen] ?? chosen);
  const facts = seamFacts(seam, names);
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    refreshMix();
  };

  return (
    <li className={`seam ${open ? 'open' : ''}`}>
      {seam.too_soon && (
        <p className="warn seam-too-soon">This leaves {previous.title} before the way into it has finished, so it would be missed. Pick a later place to leave it, or an earlier place to bring it in.</p>
      )}
      <div className="seam-line">
        <button className="seam-name" onClick={onToggle} aria-expanded={open}>
          <b>{label}</b>
          <span className={`pill ${state.status} ${state.status === 'ready' && !state.passed ? 'warned' : ''}`}>
            {seamStatusWords(state.status, state.passed)}
            {state.eta !== undefined && `, ${etaWords(state.eta)}`}
          </span>
        </button>
        <div className="seam-actions">
          {state.status === 'ready' && <button onClick={onHear}>Hear it</button>}
          {(state.status === 'none' || state.status === 'failed') && (
            <Action working="Asking…" run={async () => {
              await post(at(`/mix/${item.position}/render${state.status === 'failed' ? '?retry=true' : ''}`));
              refreshMix();
            }}>
              {state.status === 'failed' ? 'Try again' : 'Render it'}
            </Action>
          )}
          {state.status === 'ready' && (
            <span className="pair" role="group" aria-label="Rate this seam">
              <Action aria-pressed={state.rating === 'good'} run={() => rate('good')}>Good</Action>
              <Action aria-pressed={state.rating === 'bad'} run={() => rate('bad')}>Bad</Action>
            </span>
          )}
          <button onClick={onToggle}>{open ? 'Close' : 'Change'}</button>
        </div>
      </div>
      <div className={`seam-visual ${state.status}`} role="img" aria-label={`${facts.words}${plannedBars ? `, ${plannedBars} bars` : ''}, ${previous.title} into ${item.title}`}>
        <span className="seam-visual-label">{state.status === 'ready' ? 'Transition' : 'Transition plan'} · {plannedBars ? `${plannedBars} bars` : 'Length chosen when rendered'}</span>
        <div className="seam-visual-bars" aria-hidden="true">
          {Array.from({ length: plannedBars ? Math.min(Math.max(plannedBars, 1), 8) : 1 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <span className="seam-visual-caption"><b>{previous.title}</b><span>→</span><b>{item.title}</b></span>
      </div>
      {state.status === 'failed' && <p className="warn">Remembered failed attempt: {state.error}</p>}
    </li>
  );
}

type InspectorTab = 'listen' | 'change' | 'studio' | 'details';

/** Everything about one transition, in one place, for the two songs it's actually between. */
function SeamInspector(props: {
  item: MixItem;
  previous: MixItem;
  names: Record<string, string>;
  refreshMix: () => void;
  notify: (message: string, undo?: Undo) => void;
  onListen?: () => void;
  guard: Record<string, string>;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  autoPlay: boolean;
  onClose: () => void;
}) {
  const { item, previous, names, refreshMix, notify, onListen, guard, tab, setTab, autoPlay } = props;
  const seam = item.seam!;
  const state = seam.state;
  const facts = seamFacts(seam, names);
  const at = useMixPath();
  const [studio, setStudio] = useState(false);
  const [canStudio, setCanStudio] = useState<SeamOptions['studio'] | null>(null);
  const position = item.position;
  useEffect(() => {
    let live = true;
    get<SeamOptions>(at(`/mix/${position}/options`)).then((data) => { if (live) setCanStudio(data.studio ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [position, item.song_id, previous.song_id]);
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    refreshMix();
  };
  const leaveAfter = (seam.settings as SeamSettings & { leave_after?: number }).leave_after;
  const tabs: [InspectorTab, string][] = [['listen', 'Listen'], ['change', 'Change'], ['studio', 'Studio'], ['details', 'Details']];
  return (
    <div className="inspector">
      <p className="inspector-pair"><b>{previous.title}</b> <span aria-hidden="true">→</span><span className="visually-hidden"> into </span> <b>{item.title}</b></p>
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      <div className="inspector-tabs" role="tablist" aria-label="This transition">
        {tabs.map(([name, label]) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{label}</button>
        ))}
      </div>
      {tab === 'listen' && (
        <div role="tabpanel" aria-label="Listen">
          {state.status === 'ready' ? (
            <>
              {/* keyed by what was rendered, so a clip from before a change can't be mistaken for this one */}
              <AudioPreview key={state.key} src={`/api/seams/${state.key}/preview`} startAt={Math.max((state.preview_seam ?? 0) - 8, 0)} autoPlay={autoPlay} label={`${previous.title} into ${item.title}`} />
              <div className="thumbs" role="group" aria-label="Rate this seam">
                <span>How was it?</span>
                <Action aria-pressed={state.rating === 'good'} run={() => rate('good')}>Good</Action>
                <Action aria-pressed={state.rating === 'bad'} run={() => rate('bad')}>Bad</Action>
              </div>
            </>
          ) : state.status === 'failed' ? (
            <p className="hint">There’s nothing to hear yet, because this one couldn’t be made. Try another move under Change.</p>
          ) : (
            <>
              <p className="hint">{state.status === 'none' ? 'This hasn’t been rendered yet.' : `Rendering${state.eta !== undefined ? `, ${etaWords(state.eta)}` : ''}. You’ll be able to hear it here when it’s done.`}</p>
              {state.status === 'none' && (
                <Action className="primary" working="Asking…" run={async () => { await post(at(`/mix/${position}/render`), undefined, guard); refreshMix(); }}>
                  Render it
                </Action>
              )}
            </>
          )}
        </div>
      )}
      {tab === 'change' && (
        <div role="tabpanel" aria-label="Change">
          <SeamEditor position={position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} onListen={onListen} guard={guard} studioOpen={false} setStudioOpen={() => {}} />
        </div>
      )}
      {tab === 'studio' && (
        <div role="tabpanel" aria-label="Studio">
          <p className="hint">Both songs’ voice, drums, bass and melody on a grid you can hear straight away. Choose exactly what plays when, or let Selecta arrange it.</p>
          {canStudio && !canStudio.available ? (
            <p className="warn">{canStudio.reason}</p>
          ) : (
            <button className="primary" onClick={() => setStudio(true)}>Open the Studio</button>
          )}
          {studio && <SeamEditor position={position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} onListen={onListen} guard={guard} studioOpen setStudioOpen={setStudio} />}
        </div>
      )}
      {tab === 'details' && (
        <div role="tabpanel" aria-label="Details" className="report">
          {state.why && <p>{state.why}.</p>}
          {facts.asked && state.label && facts.asked !== state.label && <p className="hint">You chose {facts.asked}. What will play is {state.label}.</p>}
          {leaveAfter !== undefined && <p className="hint">Held back to leave {previous.title} after {clock(leaveAfter)}, so it gets played before moving on.</p>}
          {state.a_source_start !== undefined && <p className="hint">Leaves {previous.title} at {clock(state.a_source_start)}. {item.title} carries on from {clock(state.b_source_end ?? 0)}.</p>}
          {triedWords(state.tried ?? [], names).map((line) => <p className="hint" key={line}>{line}</p>)}
          {!!state.checks?.length && (
            <>
              <p className="hint">Measured on the finished audio. These can’t tell you how it sounds. Only you can.</p>
              <ul>
                {state.checks.map((check) => (
                  <li key={check.name} className={check.passed ? 'ok' : 'bad'}>{check.passed ? '✓' : '!'} {check.text}</li>
                ))}
              </ul>
            </>
          )}
          {!state.why && !state.checks?.length && <p className="hint">There’s nothing to report until this has been rendered.</p>}
        </div>
      )}
    </div>
  );
}

/** Exactly which mix is being saved, what it's still waiting on, and the file once it really exists.
 * If the mix changes while this is going on, it stops rather than saving something else. */
function ExportPanel(props: {
  mix: MixItem[];
  mixName: string;
  inDraft: boolean;
  guard: Record<string, string>;
  setMixData: (data: MixData) => void;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const { mix, mixName, inDraft, guard, setMixData, names, onClose } = props;
  const at = useMixPath();
  const [going, setGoing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [file, setFile] = useState<{ name: string; seconds: number } | null>(null);
  const order = useRef('');
  const seams = mix.slice(1);
  const ready = seams.filter((item) => item.seam?.state.status === 'ready').length;
  const failed = seams.filter((item) => item.seam?.state.status === 'failed');
  const left = seams.filter((item) => item.seam?.state.status !== 'ready');
  const orderNow = mix.map((item) => item.song_id).join(',');

  const start = async () => {
    setProblem('');
    setFile(null);
    order.current = orderNow;
    setGoing(true);
    try {
      setMixData(await post<MixData>(at('/mix/render'), undefined, guard));
    } catch (error) {
      setGoing(false);
      setProblem((error as Error).message);
    }
  };

  useEffect(() => {
    if (!going || saving) return;
    if (order.current !== orderNow) {
      setGoing(false);
      setProblem('This mix changed while it was getting ready, so nothing was saved. Start again when you’re happy with it.');
      return;
    }
    if (failed.length && failed.length === left.length) {
      setGoing(false);
      setProblem(`${failed.length} transition${failed.length === 1 ? '' : 's'} couldn’t be made. Pick another move for ${failed.length === 1 ? 'it' : 'them'}, then try again.`);
      return;
    }
    if (ready < seams.length) return;
    setSaving(true);
    post<{ name: string; seconds: number }>(at('/mix/export'), undefined, guard)
      .then(setFile)
      .catch((error: Error) => setProblem(error.message))
      .finally(() => {
        setSaving(false);
        setGoing(false);
      });
  }, [going, saving, orderNow, ready, seams.length, failed.length, left.length]);

  return (
    <Dialog title="Save as an audio file" onClose={onClose}>
      <p><b>{mixName}</b> <span className="soft">{inDraft ? 'draft' : 'current mix'}, {mix.length} songs. FLAC.</span></p>
      <p className="hint">{ready} of {seams.length} transitions ready. {left.length ? 'The rest get rendered first.' : 'Everything’s ready.'}</p>
      {!!left.length && (
        <ul className="export-left">
          {left.slice(0, 8).map((item) => {
            const facts = seamFacts(item.seam, names);
            return <li key={item.position}><Status kind={facts.kind}>Into {item.title}: {facts.words}</Status></li>;
          })}
          {left.length > 8 && <li className="hint">and {left.length - 8} more</li>}
        </ul>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {file ? (
        <p className="notice" role="status">Ready, {length(file.seconds)} long: <a href={`/api/exports/${file.name}`} download>download {file.name}</a></p>
      ) : (
        <button className="primary" disabled={going || saving || mix.length < 2} data-working={going || saving || undefined} onClick={() => void start()}>
          {saving ? 'Saving the file…' : going ? `Rendering ${ready} of ${seams.length}…` : 'Save it'}
        </button>
      )}
      <p className="hint">Your original songs aren’t touched.</p>
    </Dialog>
  );
}

function useNarrow(width = 1100): boolean {
  const query = `(max-width: ${width}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setNarrow(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return narrow;
}

function SongLine(props: {
  item: MixItem;
  total: number;
  setMixData: (data: MixData) => void;
  onPlay: () => void;
  onDrop: (from: number, to: number) => void;
  playing: boolean;
  notify: (message: string, undo?: Undo) => void;
  guard: Record<string, string>;
  refreshMix: () => void;
}) {
  const { item, total, setMixData, onPlay, onDrop, playing, notify, guard, refreshMix } = props;
  const [over, setOver] = useState(false);
  const at = useMixPath();
  const act = async (call: Promise<MixData>, message?: string) => {
    try {
      setMixData(await call);
      if (message) notify(message, true);
    } catch (error) {
      // what's shown was out of date, so show what's true before anyone tries again
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      throw error;
    }
  };
  return (
    <li
      className={`song ${over ? 'over' : ''} ${playing ? 'playing' : ''} ${item.from_request ? 'requested' : ''}`}
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
        <RequestTag item={item} />
      </div>
      <small className="facts">
        {item.bpm ? `${Math.round(item.bpm)} BPM` : ''} {item.key ?? ''} · {clock(item.duration)}
      </small>
      <div className="song-actions">
        <button onClick={onPlay} aria-label={`Play from ${item.title}`}>Play</button>
        <Action
          aria-label={`Move ${item.title} up`}
          disabled={item.position === 0}
          run={() => act(post<MixData>(at('/mix/move'), { source: item.position, target: item.position - 1 }, guard), `Moved ${item.title} up.`)}
        >
          ↑
        </Action>
        <Action
          aria-label={`Move ${item.title} down`}
          disabled={item.position === total - 1}
          run={() => act(post<MixData>(at('/mix/move'), { source: item.position, target: item.position + 1 }, guard), `Moved ${item.title} down.`)}
        >
          ↓
        </Action>
        <Action
          aria-pressed={item.locked}
          title="A locked song stays right here when the mix is rebuilt"
          run={() => act(post<MixData>(at(`/mix/${item.position}/lock`), undefined, guard))}
        >
          {item.locked ? 'Locked' : 'Lock'}
        </Action>
        <Action aria-label={`Remove ${item.title}`} run={() => act(del<MixData>(at(`/mix/songs/${item.position}`), guard), `Removed ${item.title}.`)}>
          ✕
        </Action>
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
  // a transition is known by the two songs it's between, so it stays selected as the mix moves around
  const [selected, setSelected] = useState<{ a: number; b: number } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('listen');
  const [hearNow, setHearNow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const narrow = useNarrow();
  const [adding, setAdding] = useState<number | null>(inDraft && !mix.length ? 0 : null);
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState('');
  const guard = { 'x-mix-order': mix.map((item) => item.song_id).join(',') };
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(mixName);

  const total = runningTime(mix);
  const seams = mix.slice(1).map((item) => item.seam!.state);
  const ready = seams.filter((state) => state.status === 'ready').length;
  const failed = seams.filter((state) => state.status === 'failed').length;

  const addSong = async (song: Suggestion, position: number) => {
    try {
      setMixData(await post<MixData>(at('/mix/songs'), { song_id: song.song_id, position }, guard));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      setProblem((error as Error).message);
      return;
    }
    setAdding(null);
    notify(`Added ${song.title}.`, true);
  };

  const waiting = seams.filter((state) => state.status === 'none').length;
  const rendering = seams.filter((state) => state.status === 'queued' || state.status === 'rendering').length;

  const renderAll = async () => {
    setMixData(await post<MixData>(at('/mix/render')));
    notify(`Rendering ${waiting} seam${waiting === 1 ? '' : 's'}, in order, ahead of everything else.`);
  };

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
      notify(placed.place === 1 && next.current.left === 0 ? 'Rendering this in the background.' : `This is in line, and will be ready in ${etaRangeWords(placed.eta ?? undefined)}.`);
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

  const selectedIndex = selected ? mix.findIndex((item, index) => index > 0 && item.song_id === selected.b && mix[index - 1].song_id === selected.a) : -1;
  const selectedItem = selectedIndex > 0 ? mix[selectedIndex] : null;
  const selectedBefore = selectedIndex > 0 ? mix[selectedIndex - 1] : null;
  const inspector = selectedItem && selectedBefore && (
    <SeamInspector
      key={`${selectedBefore.song_id}-${selectedItem.song_id}`}
      item={selectedItem}
      previous={selectedBefore}
      names={status.moves}
      refreshMix={refreshMix}
      notify={notify}
      guard={guard}
      tab={inspectorTab}
      setTab={(tab) => { setHearNow(false); setInspectorTab(tab); }}
      autoPlay={hearNow}
      onClose={() => setSelected(null)}
      onListen={() => {
        if (now.phase === 'playing') void player.togglePause();
      }}
    />
  );
  const scrollWhileDragging = (event: DragEvent) => {
    const margin = 90;
    if (event.clientY < margin) window.scrollBy?.(0, -18);
    else if (event.clientY > window.innerHeight - margin) window.scrollBy?.(0, 18);
  };

  const clear = async () => {
    player.stop();
    setMixData(await post<MixData>('/mix/clear'));
    notify('Cleared the mix.', true);
  };

  if (!mix.length && inDraft) {
    return (
      <main className="page mix" id="main">
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
    <main className="page mix" id="main">
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
          {mix.length > 1 && <button onClick={() => setExporting(true)}>Download audio</button>}
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
      {exporting && <ExportPanel mix={mix} mixName={mixName} inDraft={inDraft} guard={guard} setMixData={setMixData} names={status.moves} onClose={() => setExporting(false)} />}

      <div className={`edit-layout ${selectedIndex > 0 && !narrow ? 'has-inspector' : ''}`}>
      <ol className="timeline" onDragOver={scrollWhileDragging}>
        {mix.map((item, index) => (
          <FragmentRow key={`${item.song_id}-${index}`}>
            {index > 0 && (
              <SeamUnlessReplaced
                inDraft={inDraft}
                item={item}
                previous={mix[index - 1]}
                refreshMix={refreshMix}
                names={status.moves}
                notify={notify}
                open={selectedIndex === index}
                onToggle={() => {
                  setHearNow(false);
                  setInspectorTab('change');
                  setSelected(selectedIndex === index ? null : { a: mix[index - 1].song_id, b: item.song_id });
                }}
                onHear={() => {
                  setHearNow(true);
                  setInspectorTab('listen');
                  setSelected({ a: mix[index - 1].song_id, b: item.song_id });
                }}
              />
            )}
            <SongLine
              item={item}
              total={mix.length}
              setMixData={setMixData}
              notify={notify}
              guard={guard}
              refreshMix={refreshMix}
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
                  void post<MixData>(at('/mix/move'), { source: from, target: to }, guard).then((data) => {
                    setMixData(data);
                    notify('Moved that song.', true);
                  }).catch((error: Error) => {
                    // the row goes back where it was, because nothing actually moved
                    setProblem(error.message);
                    refreshMix();
                  });
                }
              }}
            />
            {!inDraft && <ComingSongs afterSongId={item.song_id} />}
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
      {selectedItem && selectedBefore && !narrow && (
        <aside className="edit-inspector" aria-label="This transition">
          <div className="inspector-head">
            <h2>Transition</h2>
            <button aria-label="Close" onClick={() => setSelected(null)}>✕</button>
          </div>
          {inspector}
        </aside>
      )}
      </div>
      {selectedItem && selectedBefore && narrow && (
        <Sheet title="Transition" onClose={() => setSelected(null)}>{inspector}</Sheet>
      )}
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
