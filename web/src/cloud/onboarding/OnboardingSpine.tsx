import { CSSProperties, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clockTime, playbackStatusText } from '../../copy';
import { Moment } from '../../feel/moment';
import { BlendArt } from '../BlendArt';
import { feelOn, onFeelChange } from '../../feel/root';
import { flagOn, useFlag } from '../../flags';
import { rememberFolder, type DirectoryHandleLike, type ImportSource } from '../../media';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon, IconName } from '../../ui/Icon';
import { cancelImportSession, readImportMarker, startImportSession, useImportSession } from '../importSession';
import { preloadImportCode } from '../../media/importer';
import { AudioSession, defaultDeps, SpineDeps } from './deps';
import { FRESH, loadState, previousStep, saveState, settleVerifyLater, SpineState, STEP_TITLES, StepId, StepOutcome, STEPS } from './state';
import { CapabilityStep, ConnectStep, KeepAwakeStep, OutputStep, RemoteStep, SoundcheckStep, StartStep, StepProps, VerifyStep } from './steps';

/** A folder handle, as opposed to a list of picked files. */
const isFolder = (source: ImportSource): source is DirectoryHandleLike => (source as { kind?: string }).kind === 'directory';

export { onboardingFinished } from './state';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const MARKS: Record<StepOutcome | 'current' | 'ahead', { icon: IconName; words: string }> = {
  done: { icon: 'check', words: 'done' },
  skipped: { icon: 'minus', words: 'skipped' },
  unverified: { icon: 'warning', words: 'sound not confirmed' },
  not_here: { icon: 'minus', words: 'not on this device' },
  current: { icon: 'dot', words: 'now' },
  ahead: { icon: 'circle', words: 'to do' },
};

/** The local-first onboarding spine (ADR-0463 BF-0463-02): from an empty account to hearing your
 * own music on this device, resumable per account and skippable where that is honest. The sound
 * check passes only when a person presses "I heard it". `deps` is for tests; the defaults use the
 * engine and media modules. */
export function OnboardingSpine({ request, workspaceId, onDone, deps: given }: {
  request: Request;
  workspaceId: string;
  onDone(): void;
  deps?: Partial<SpineDeps>;
}) {
  const deps = useMemo<SpineDeps>(() => ({ ...defaultDeps(request, workspaceId), ...given }), [request, workspaceId, given]);
  const [state, setState] = useState<SpineState>(() => loadState(deps.storage, workspaceId));
  const live = useImportSession(workspaceId);
  const progressive = useFlag('cloud.progressive_import');
  const audio = useRef<AudioSession | null>(null);
  // The page around the spine owns the one h1 ("Welcome to SelectaDJ"); each step is an h2.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const [restarting, setRestarting] = useState(false);
  const resilient = useFlag('cloud.resilient_import');
  // The feel system (ADR-0477): each step card arrives from the side the person is travelling
  // toward, and finishing is marked once. Both are inert with app.feel_motion off.
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const direction = useRef<'forward' | 'back'>('forward');
  const [celebrating, setCelebrating] = useState(false);
  // finished by a press in this visit, not opened already finished
  const [finishedHere, setFinishedHere] = useState(false);
  // The first two songs this import really took in, by their file names, for the finish: the blend
  // drawing there names the person's own music instead of "Now playing" and "Up next", with the
  // feel's motion on. Only names seen in this visit; after a reload the finish has no drawing.
  const firstSongs = useRef<string[]>([]);
  const counted = useRef(live.registered);
  // a name is taken only as the count of songs taken in rises, so a file that failed is never named
  if (live.registered > counted.current && live.current && firstSongs.current.length < 2 && !firstSongs.current.includes(live.current)) {
    firstSongs.current = [...firstSongs.current, live.current];
  }
  counted.current = live.registered;
  // load the fingerprinting code before any import, so going offline never fails every file
  useEffect(() => { if (flagOn('cloud.resilient_import')) preloadImportCode(); }, []);

  // With `cloud.progressive_import` on, the import belongs to the session and outlives this
  // spine (the shell cancels it when the shell itself goes); off, leaving the spine stops it.
  useEffect(() => () => {
    if (!flagOn('cloud.progressive_import')) cancelImportSession();
    audio.current?.dispose();
    audio.current = null;
  }, []);

  // Each step change is saved, and focus moves to the new step's title so keyboard and screen
  // reader users land on what changed (not on the first paint).
  const change = (next: SpineState) => {
    const from = STEPS.indexOf(state.step);
    const to = STEPS.indexOf(next.step);
    if (to !== from) direction.current = to > from ? 'forward' : 'back';
    // only the press that really finishes the spine is celebrated, never a reload of a finished one
    if (next.finished && !state.finished && feelOn('moments')) setCelebrating(true);
    if (next.finished && !state.finished) setFinishedHere(true);
    setState(next);
    saveState(deps.storage, workspaceId, next);
  };

  // A finished import lands in the saved state whether or not the member is still on verify.
  const seen = useRef(live.summary);
  useEffect(() => {
    // a storage-full pause also ends the run, with its own honest summary
    if ((live.phase !== 'finished' && live.phase !== 'paused') || !live.summary || seen.current === live.summary) return;
    seen.current = live.summary;
    setState((current) => {
      const next = settleVerifyLater(current, live.summary!);
      saveState(deps.storage, workspaceId, next);
      return next;
    });
  }, [live.phase, live.summary, deps.storage, workspaceId]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [state.step, state.finished]);

  const openSession = (): AudioSession | string => {
    if (audio.current) return audio.current;
    const opened = deps.openAudio();
    if (typeof opened !== 'string') audio.current = opened;
    return opened;
  };

  const startImport = (source: ImportSource) => {
    // a new import's verify outcome is its own: an earlier one's tally and verdict are dropped
    const outcomes = { ...state.outcomes, connect: 'done' as const };
    delete outcomes.verify;
    change({ ...state, step: 'verify', outcomes, imported: undefined });
    const folder = isFolder(source) ? source.name : undefined;
    if (isFolder(source)) void rememberFolder(workspaceId, source);
    // cloud.resilient_import: the same music picked again carries an interrupted import on,
    // skipping everything already done
    void startImportSession({
      source, run: deps.importMusic, workspaceId, folder,
      ...(flagOn('cloud.resilient_import') ? { kind: isFolder(source) ? 'folder' as const : 'files' as const, resume: readImportMarker(workspaceId) } : {}),
    });
  };
  // Carry on while checking continues: verify stays unsettled until the import finishes.
  const continueEarly = () => change({ ...state, step: 'capability' });

  // Back walks to the step before this one. Its outcome is kept until the step is settled again,
  // so going back to look never undoes a sound check someone really heard.
  // While music is being checked, Back would only offer a second import over the first.
  const back = state.step === 'verify' && live.phase === 'running' ? null : previousStep(state);
  // Finish later is remembered for this account on this browser, so a reload or a link to another
  // page opens that page and not the spine again; the step and outcomes are kept for carrying on.
  const later = () => { change({ ...state, later: true }); onDone(); };
  const goBack = () => { if (back) change({ ...state, step: back }); };

  const props: StepProps = { state, onChange: change, deps, session: () => audio.current, openSession };

  if (state.finished) {
    const status = state.heardAt !== undefined
      ? `You confirmed hearing the check tone at ${clockTime(state.heardAt)}. If anything changes, like a speaker dropping, SelectaDJ will say the sound isn’t confirmed until you check again.`
      : state.capability?.ok === false
        ? 'This device is set up as a controller.'
        : playbackStatusText({ state: 'output_unverified' });
    // With motion on, the finish card's lines come in one after another (data-stagger), under the
    // one celebration of the blend; Open SelectaDJ is the one glowing action (styles/feel-entry.css).
    const line = (index: number) => (moving ? ({ '--i': index }) as CSSProperties : undefined);
    return (
      <section className="cloud-spine" aria-labelledby={`spine-${workspaceId}-title`} data-spine="finished" data-stagger={moving ? '' : undefined}>
        <p className="cloud-eyebrow" style={line(0)}>Getting started</p>
        <h2 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1} style={line(1)}>You’re set up</h2>
        <StepList state={state} drawn={moving} style={line(2)} />
        <p role="status" style={line(3)}>{status}</p>
        <div className="cloud-actions" style={line(4)}>
          <button type="button" className="primary" onClick={onDone}>Open SelectaDJ</button>
          <button type="button" onClick={() => setRestarting(true)}>Go through it again</button>
        </div>
        {restarting && (
          <ConfirmDialog
            title="Go through set-up again?"
            body="The steps start over from the beginning. Your music and library stay exactly as they are, and the sound check needs someone to hear the tone again."
            confirmLabel="Start again"
            cancelLabel="Keep my set-up"
            onConfirm={() => change(FRESH)}
            onClose={() => setRestarting(false)}
          />
        )}
        {finishedHere && moving && firstSongs.current.length === 2 && (
          <div className="cloud-spine-blend" aria-hidden="true">
            <BlendArt from={songName(firstSongs.current[0])} to={songName(firstSongs.current[1])} />
          </div>
        )}
        {celebrating && <span className="cloud-spine-moment" aria-hidden="true"><Moment kind="blend" onDone={() => setCelebrating(false)} /></span>}
      </section>
    );
  }

  const step = state.step;
  return (
    <section className="cloud-spine" aria-labelledby={`spine-${workspaceId}-title`}>
      <p className="cloud-eyebrow">Getting started · Step {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
      <h2 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1}>{STEP_TITLES[step]}</h2>
      <StepList state={state} drawn={moving} />
      {/* keyed by step with motion on, so each new step's card arrives again, from its direction */}
      <div className="cloud-card cloud-spine-step" data-step={step} key={moving ? step : undefined} data-arrive={moving ? '' : undefined} data-dir={moving ? direction.current : undefined}>
        {step === 'connect' && !(resilient && live.phase === 'running') && <ConnectStep {...props} onPick={startImport} workspaceId={workspaceId} />}
        {(step === 'verify' || (step === 'connect' && resilient && live.phase === 'running')) && <VerifyStep {...props} live={live} earlyContinue={progressive} onStop={cancelImportSession} onContinueEarly={continueEarly} />}
        {step === 'capability' && <CapabilityStep {...props} />}
        {step === 'output' && <OutputStep {...props} />}
        {step === 'start' && <StartStep {...props} />}
        {step === 'soundcheck' && <SoundcheckStep {...props} />}
        {step === 'keepawake' && <KeepAwakeStep {...props} />}
        {step === 'remote' && <RemoteStep {...props} />}
      </div>
      <div className="cloud-actions">
        {back && <button type="button" onClick={goBack}>Back</button>}
        <button type="button" className="cloud-spine-later" onClick={later}>Finish later</button>
      </div>
    </section>
  );
}

/** A song's file name as a short tag: no folder and no extension. */
export function songName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const bare = base.replace(/\.[a-z0-9]{2,5}$/i, '');
  return bare.length > 28 ? `${bare.slice(0, 27)}…` : bare;
}

/** The step rail. With `drawn` (the feel system's motion), a finished step's mark is a tick that
 * draws itself the moment the step is done, and the phone's bars fill on a spring
 * (styles/feel-entry.css); without it, the marks are the icons as before. */
function StepList({ state, drawn = false, style }: { state: SpineState; drawn?: boolean; style?: CSSProperties }) {
  return (
    <ol className="cloud-spine-steps" aria-label="Steps" style={style}>
      {STEPS.map((id: StepId) => {
        const outcome = state.outcomes[id];
        const current = !state.finished && state.step === id;
        const mark = MARKS[current ? 'current' : outcome ?? 'ahead'];
        return (
          <li key={id} aria-current={current ? 'step' : undefined} data-outcome={outcome ?? (current ? 'current' : 'ahead')}>
            {drawn && !current && outcome === 'done'
              ? <svg className="cloud-spine-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              : <Icon name={mark.icon} size="compact" />}
            <span>{STEP_TITLES[id]}</span>
            <span className="visually-hidden">, {mark.words}</span>
          </li>
        );
      })}
    </ol>
  );
}
