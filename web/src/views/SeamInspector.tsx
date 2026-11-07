import { useContext, useEffect, useId, useRef, useState } from 'react';
import { ApiError, get, MixItem, post, SeamOptions, SeamSettings } from '../api';
import { clock, triedWords } from '../lib';
import { AudioPreview } from '../ui/AudioPreview';
import { Action, Problem, Skeleton, Status, Workspace } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Tabs } from '../ui/primitives';
import { seamFacts, seamLayers } from '../ui/seam';
import { MixScope, useMixPath } from './mixScope';
import { Undo } from './shared';
import { Studio } from './Studio';

const cueRange = (cues: { time: number }[]) => {
  if (!cues.length) return null;
  const times = cues.map((cue) => cue.time);
  return `${clock(Math.min(...times))} to ${clock(Math.max(...times))}`;
};

/** Requested, on its way, made, and heard, kept apart, because they can all be different at once. */
function SeamLayersView({ seam, names }: { seam: MixItem['seam']; names: Record<string, string> }) {
  const layers = seamLayers(seam, names);
  return (
    <dl className="seam-layers">
      <div><dt>You chose</dt><dd>{layers.requested}</dd></div>
      <div><dt>In progress</dt><dd>{layers.inProgress ?? 'Nothing right now'}</dd></div>
      <div><dt>Made so far</dt><dd>{layers.rendered ?? 'Nothing yet'}</dd></div>
      <div className={layers.fellBack ? 'differs' : undefined}>
        <dt>You’d hear</dt>
        <dd>{layers.heard}{layers.fellBack ? ', which isn’t what you chose' : ''}</dd>
      </div>
    </dl>
  );
}

function SeamEditor(props: {
  position: number;
  item: MixItem;
  previous: MixItem;
  refreshMix: () => void;
  notify: (message: string, undo?: Undo) => void;
  guard: Record<string, string>;
  names: Record<string, string>;
}) {
  const { position, item, previous, refreshMix, notify, guard, names } = props;
  const [options, setOptions] = useState<SeamOptions | null>(null);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const at = useMixPath();
  const problemId = useId();
  // What was just chosen shows straight away and stays until the server has it, so a slow answer
  // can't make the choice look as if it didn't take. One change goes at a time, and the last one wins.
  const [intent, setIntent] = useState<SeamSettings | null>(null);
  const latestIntent = useRef<SeamSettings | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const onServer = JSON.stringify(item.seam?.settings ?? {});
  useEffect(() => {
    latestIntent.current = null;
    setIntent(null);
  }, [onServer]);
  const settings: SeamSettings = intent ?? item.seam?.settings ?? {};
  // what the person chose is what's pressed, always. What actually got made is shown beside it
  const requested = settings.move ?? 'auto';
  const state = item.seam?.state;
  // with Selecta choosing, the settings worth offering are the ones for the move it went with
  const inPlay = requested === 'auto' && state?.status === 'ready' && state.style ? state.style : requested;

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

  const change = (changes: SeamSettings) => {
    const next = { ...(latestIntent.current ?? item.seam?.settings ?? {}), ...changes };
    latestIntent.current = next;
    setIntent(next);
    setProblem('');
    const work = queue.current.then(async () => {
      if (latestIntent.current !== next) return;
      try {
        // anything the person picks is their choice, so it stops being Selecta's to replace
        await post(at(`/mix/${position}/seam`), { ...next, soft: false }, guard);
        await post(at(`/mix/${position}/render`), undefined, guard);
        refreshMix();
        notify('Changed that seam. Rendering it now.', true);
      } catch (error) {
        latestIntent.current = null;
        setIntent(null);
        setProblem((error as Error).message);
        if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      }
    });
    queue.current = work;
    return work;
  };

  if (problem && !options) return <Problem retry={() => setAttempt((value) => value + 1)}>{problem}</Problem>;
  if (!options) return <Skeleton variant="inspector" label="Working out what’s possible" />;

  const move = options.moves.find((option) => option.name === requested) ?? options.moves.find((option) => option.name === inPlay);
  const blends = ['bass_swap_blend', 'filter_sweep'].includes(inPlay);
  const rides = ['vocal_ride', 'word_blend', 'word_exchange'].includes(inPlay);
  const usesCues = ['bass_swap_blend', 'filter_sweep', 'tempo_ramp', 'cut_on_one', 'echo_out', 'delay_throw', 'reverb_wash'].includes(inPlay);
  const usesPhrase = ['word_blend', 'word_exchange', 'phrase_roll', 'word_cut'].includes(inPlay);
  const off = options.moves.filter((option) => !option.available);
  const fellBack = state?.status === 'ready' && !!state.style && requested !== 'auto' && state.style !== requested;
  const askedName = names[requested] ?? options.moves.find((option) => option.name === requested)?.label ?? requested.replaceAll('_', ' ');
  const exitRange = cueRange(options.exits);
  const entryRange = cueRange(options.entries);
  const cueProps = problem ? { 'aria-invalid': true as const, 'aria-describedby': problemId } : {};
  return (
    <div className="editor stack">
      {requested === 'stem_studio' && <p className="hint">You shaped this one in the studio.</p>}
      {requested === 'stem_arrange' && (
        <p className="hint">Selecta built this from what’s in the stems, and learns from every one you rate. Open the grid to see or change it.</p>
      )}
      {fellBack && (
        <p className="warn">
          You asked for {askedName}. {state?.label ?? 'Another move'} will play instead, because {askedName} wouldn’t work here. Your choice stays as it is until you change it.
        </p>
      )}
      {item.seam?.too_soon && <p className="warn">Right now this would leave {previous.title} too early. Pick a later place to leave it, or an earlier place to bring in {item.title}.</p>}
      <fieldset>
        <legend>How should this land?</legend>
        <div className="chips moves">
          {options.moves.map((option) => (
            <Action
              key={option.name}
              aria-pressed={requested === option.name}
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
            <Action aria-pressed={settings.bars === undefined} run={() => change({ bars: undefined })}>
              Pick for me
            </Action>
            {(blends ? [4, 8, 16] : [4, 8, 12, 16]).map((bars) => (
              <Action key={bars} aria-pressed={settings.bars === bars} run={() => change({ bars })}>
                {bars} bars
              </Action>
            ))}
          </div>
        </fieldset>
      )}

      {usesPhrase && options.links.length > 1 && (
        <fieldset>
          <legend>Which phrase</legend>
          <div className="chips">
            {options.links.map((link) => (
              <Action
                key={link.phrase}
                aria-pressed={(settings.phrase ?? options.links[0].phrase) === link.phrase}
                title={`“${link.line_a}” into “${link.line_b}”`}
                run={() => change({ phrase: link.phrase })}
              >
                {link.phrase}
              </Action>
            ))}
          </div>
        </fieldset>
      )}

      {usesCues && (
        <fieldset>
          <legend>Exact cues</legend>
          <div className="cue-row">
            <label>
              <span>Leave <b>{previous.title}</b> at</span>
              <select
                {...cueProps}
                disabled={!options.exits.length}
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
              <small className="hint">{exitRange ? `Possible from ${exitRange}.` : 'Selecta hasn’t found another safe place to leave it.'}</small>
            </label>
            <label>
              <span>Bring in <b>{item.title}</b> at</span>
              <select
                {...cueProps}
                disabled={!options.entries.length}
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
              <small className="hint">{entryRange ? `Possible from ${entryRange}.` : 'Selecta hasn’t found another safe place to bring it in.'}</small>
            </label>
          </div>
        </fieldset>
      )}
      {problem && <p className="warn" id={problemId} role="alert">{problem}</p>}
    </div>
  );
}

export type InspectorTab = 'listen' | 'change' | 'studio' | 'details';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'listen', label: 'Listen' },
  { id: 'change', label: 'Change' },
  { id: 'studio', label: 'Studio' },
  { id: 'details', label: 'Details' },
];

/** Everything about one transition, in one place, for the two songs it's actually between. The pair it
 * belongs to stays on screen while this scrolls, and the editor keys this by that pair, so nothing here
 * can ever act on a different one. */
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
  const layers = seamLayers(seam, names);
  const scope = useContext(MixScope);
  const at = useMixPath();
  const [studio, setStudio] = useState(false);
  const [canStudio, setCanStudio] = useState<SeamOptions['studio'] | null>(null);
  const position = item.position;
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setCanStudio(null);
    setCapabilityError(false);
    get<SeamOptions>(at(`/mix/${position}/options`)).then((data) => { if (live) setCanStudio(data.studio ?? { available: false, reason: 'This server does not support Stem Studio for this transition.' }); }).catch(() => { if (live) setCapabilityError(true); });
    return () => { live = false; };
  }, [position, item.song_id, previous.song_id, capabilityAttempt]);
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    refreshMix();
  };
  const leaveAfter = (seam.settings as SeamSettings & { leave_after?: number }).leave_after;
  const tempo = previous.bpm && item.bpm ? `${Math.round(previous.bpm)} to ${Math.round(item.bpm)} BPM` : null;
  const keys = previous.key && item.key ? `${previous.key} to ${item.key}` : null;
  return (
    <div className="inspector">
      <div className="inspector-identity">
        <p className="inspector-pair"><b>{previous.title}</b> <span aria-hidden="true">→</span><span className="visually-hidden"> into </span> <b>{item.title}</b></p>
        <p className="inspector-scope">
          <span>{scope === null ? 'In the current mix' : 'In a draft'}</span>
          {layers.version && <span>Version {layers.version}</span>}
        </p>
        <p className="inspector-state"><Status kind={facts.kind}>{facts.words}</Status></p>
      </div>
      <Tabs label="This transition" tabs={TABS} current={tab} onChange={setTab}>
        {tab === 'listen' && (
          <>
            <SeamLayersView seam={seam} names={names} />
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
                <p className="hint">{state.status === 'none' ? 'This hasn’t been rendered yet.' : 'You’ll be able to hear it here when it’s done.'}</p>
                {state.status === 'none' && (
                  <Action className="primary" working="Asking…" run={async () => { await post(at(`/mix/${position}/render`), undefined, guard); refreshMix(); }}>
                    Render it
                  </Action>
                )}
              </>
            )}
          </>
        )}
        {tab === 'change' && <SeamEditor position={position} item={item} previous={previous} refreshMix={refreshMix} notify={notify} guard={guard} names={names} />}
        {tab === 'studio' && (
          <>
            <p className="hint">Both songs’ voice, drums, bass and melody on a grid you can hear straight away. Choose exactly what plays when, or let Selecta arrange it.</p>
            {capabilityError ? <Problem retry={() => setCapabilityAttempt((value) => value + 1)}>Couldn’t check Studio availability.</Problem> : !canStudio ? <Skeleton variant="inspector" label="Checking Studio availability" /> : !canStudio.available ? (
              <p className="warn">{canStudio.reason}</p>
            ) : (
              <button className="primary" onClick={() => setStudio(true)}>Open the Studio</button>
            )}
          </>
        )}
        {tab === 'details' && (
          <div className="report">
            {state.status === 'ready' && <h3 className="report-head">What will play</h3>}
            {state.status === 'ready' && state.label && <p>{state.label}</p>}
            {state.why && <p>{state.why}.</p>}
            {facts.asked && state.label && facts.asked !== state.label && <p className="hint">You chose {facts.asked}. What will play is {state.label}.</p>}
            {(leaveAfter !== undefined || state.a_source_start !== undefined || tempo || keys) && <h3 className="report-head">The music</h3>}
            {leaveAfter !== undefined && <p className="hint">Held back to leave {previous.title} after {clock(leaveAfter)}, so it gets played before moving on.</p>}
            {state.a_source_start !== undefined && <p className="hint">Leaves {previous.title} at {clock(state.a_source_start)}. {item.title} carries on from {clock(state.b_source_end ?? 0)}.</p>}
            {(tempo || keys) && <p className="hint">{[tempo, keys].filter(Boolean).join(', keys ')}.</p>}
            {!!state.tried?.length && <h3 className="report-head">What else was tried</h3>}
            {triedWords(state.tried ?? [], names).map((line) => <p className="hint" key={line}>{line}</p>)}
            {!!state.checks?.length && (
              <>
                <h3 className="report-head">Quality checks</h3>
                <p className="hint">Measured on the finished audio. These can’t tell you how it sounds. Only you can.</p>
                <ul>
                  {state.checks.map((check) => (
                    <li key={check.name} className={check.passed ? 'ok' : 'bad'}><Icon name={check.passed ? 'check' : 'warning'} width={14} height={14} /> {check.text}</li>
                  ))}
                </ul>
              </>
            )}
            {!state.why && !state.checks?.length && <p className="hint">There’s nothing to report until this has been rendered.</p>}
          </div>
        )}
      </Tabs>
      {studio && (
        <Workspace title={`${previous.title} into ${item.title}`} onClose={() => setStudio(false)}>
          <Studio
            position={position}
            item={item}
            previous={previous}
            names={names}
            onClose={() => setStudio(false)}
            onUsed={() => refreshMix()}
            onConflict={refreshMix}
            onListen={onListen}
            notify={notify}
            guard={guard}
          />
        </Workspace>
      )}
    </div>
  );
}
