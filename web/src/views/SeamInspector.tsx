import { useEffect, useId, useState } from 'react';
import { ApiError, get, MixItem, post, SeamOptions, SeamSettings } from '../api';
import { clock, etaWords, triedWords } from '../lib';
import { AudioPreview } from '../ui/AudioPreview';
import { Action, Problem, Skeleton, Status, Workspace } from '../ui/controls';
import { seamFacts } from '../ui/seam';
import { useMixPath } from './mixScope';
import { Undo } from './shared';
import { Studio } from './Studio';

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
  const [attempt, setAttempt] = useState(0);
  const at = useMixPath();
  const settings: SeamSettings = item.seam?.settings ?? {};
  const planned = settings.move ?? 'auto';
  const state = item.seam?.state;
  // once a seam has rendered, the move to show is the one you're hearing, even if another was planned
  const chosen = state?.status === 'ready' && state.style ? state.style : planned;

  useEffect(() => {
    let live = true;
    setOptions(null);
    setProblem('');
    get<SeamOptions>(at(`/mix/${position}/options`))
      .then((data) => live && setOptions(data))
      .catch((error: Error) => live && setProblem(error.message));
    return () => {
      live = false;
    };
  }, [position, item.song_id, previous.song_id, attempt]);

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

  if (problem && !options) return <Problem retry={() => setAttempt((value) => value + 1)}>{problem}</Problem>;
  if (!options) return <Skeleton variant="inspector" label="Working out what’s possible" />;
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
            <Action
              key={option.name}
              aria-pressed={chosen === option.name}
              disabled={!option.available}
              title={option.reason ?? option.description}
              run={() => change({ move: option.name, bars: undefined, phrase: undefined, exit_bar: undefined, entry_bar: undefined })}
            >
              {option.label}
            </Action>
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
              <Action key={bars} aria-pressed={settings.bars === bars} run={() => change({ bars })}>
                {bars} bars
              </Action>
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

export type InspectorTab = 'listen' | 'change' | 'studio' | 'details';

/** Everything about one transition, in one place, for the two songs it's actually between. */
export function SeamInspector(props: {
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
  const tabId = useId();
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setCanStudio(null);
    setCapabilityError(false);
    setStudio(false);
    get<SeamOptions>(at(`/mix/${position}/options`)).then((data) => { if (live) setCanStudio(data.studio ?? { available: false, reason: 'This server does not support Stem Studio for this transition.' }); }).catch(() => { if (live) setCapabilityError(true); });
    return () => { live = false; };
  }, [position, item.song_id, previous.song_id, capabilityAttempt]);
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
          <button key={name} role="tab" id={`${tabId}-${name}`} aria-controls={`${tabId}-${name}-panel`} tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} onClick={() => setTab(name)} onKeyDown={(event) => {
            const index = tabs.findIndex(([value]) => value === name);
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
            if (target === null) return;
            event.preventDefault();
            event.stopPropagation();
            setTab(tabs[target][0]);
            document.getElementById(`${tabId}-${tabs[target][0]}`)?.focus();
          }}>{label}</button>
        ))}
      </div>
      {tab === 'listen' && (
        <div role="tabpanel" id={`${tabId}-listen-panel`} aria-labelledby={`${tabId}-listen`} tabIndex={0}>
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
        <div role="tabpanel" id={`${tabId}-change-panel`} aria-labelledby={`${tabId}-change`} tabIndex={0}>
          <SeamEditor position={position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} onListen={onListen} guard={guard} studioOpen={false} setStudioOpen={() => {}} />
        </div>
      )}
      {tab === 'studio' && (
        <div role="tabpanel" id={`${tabId}-studio-panel`} aria-labelledby={`${tabId}-studio`} tabIndex={0}>
          <p className="hint">Both songs’ voice, drums, bass and melody on a grid you can hear straight away. Choose exactly what plays when, or let Selecta arrange it.</p>
          {capabilityError ? <Problem retry={() => setCapabilityAttempt((value) => value + 1)}>Couldn’t check Studio availability.</Problem> : !canStudio ? <Skeleton variant="inspector" label="Checking Studio availability" /> : !canStudio.available ? (
            <p className="warn">{canStudio.reason}</p>
          ) : (
            <button className="primary" onClick={() => setStudio(true)}>Open the Studio</button>
          )}
          {studio && <SeamEditor position={position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} onListen={onListen} guard={guard} studioOpen setStudioOpen={setStudio} />}
        </div>
      )}
      {tab === 'details' && (
        <div role="tabpanel" id={`${tabId}-details-panel`} aria-labelledby={`${tabId}-details`} tabIndex={0} className="report">
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
