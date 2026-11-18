import { useEffect, useMemo, useRef, useState } from 'react';
import { clockTime, playbackStatusText } from '../../copy';
import { flagOn, useFlag } from '../../flags';
import { rememberFolder, type DirectoryHandleLike, type ImportSource } from '../../media';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon, IconName } from '../../ui/Icon';
import { cancelImportSession, startImportSession, useImportSession } from '../importSession';
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
  const live = useImportSession();
  const progressive = useFlag('cloud.progressive_import');
  const audio = useRef<AudioSession | null>(null);
  // The page around the spine owns the one h1 ("Welcome to SelectaDJ"); each step is an h2.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const [restarting, setRestarting] = useState(false);

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
    void startImportSession({ source, run: deps.importMusic, workspaceId, folder });
  };
  // Carry on while checking continues: verify stays unsettled until the import finishes.
  const continueEarly = () => change({ ...state, step: 'capability' });

  // Back walks to the step before this one. Its outcome is kept until the step is settled again,
  // so going back to look never undoes a sound check someone really heard.
  // While music is being checked, Back would only offer a second import over the first.
  const back = state.step === 'verify' && live.phase === 'running' ? null : previousStep(state);
  const goBack = () => { if (back) change({ ...state, step: back }); };

  const props: StepProps = { state, onChange: change, deps, session: () => audio.current, openSession };

  if (state.finished) {
    const status = state.heardAt !== undefined
      ? `You confirmed hearing the check tone at ${clockTime(state.heardAt)}. If anything changes, like a speaker dropping, SelectaDJ will say the sound isn’t confirmed until you check again.`
      : state.capability?.ok === false
        ? 'This device is set up as a controller.'
        : playbackStatusText({ state: 'output_unverified' });
    return (
      <section className="cloud-spine" aria-labelledby={`spine-${workspaceId}-title`}>
        <p className="cloud-eyebrow">GETTING STARTED</p>
        <h2 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1}>You’re set up</h2>
        <StepList state={state} />
        <p role="status">{status}</p>
        <div className="cloud-actions">
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
      </section>
    );
  }

  const step = state.step;
  return (
    <section className="cloud-spine" aria-labelledby={`spine-${workspaceId}-title`}>
      <p className="cloud-eyebrow">GETTING STARTED · STEP {STEPS.indexOf(step) + 1} OF {STEPS.length}</p>
      <h2 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1}>{STEP_TITLES[step]}</h2>
      <StepList state={state} />
      <div className="cloud-card cloud-spine-step" data-step={step}>
        {step === 'connect' && <ConnectStep {...props} onPick={startImport} />}
        {step === 'verify' && <VerifyStep {...props} live={live} earlyContinue={progressive} onStop={cancelImportSession} onContinueEarly={continueEarly} />}
        {step === 'capability' && <CapabilityStep {...props} />}
        {step === 'output' && <OutputStep {...props} />}
        {step === 'start' && <StartStep {...props} />}
        {step === 'soundcheck' && <SoundcheckStep {...props} />}
        {step === 'keepawake' && <KeepAwakeStep {...props} />}
        {step === 'remote' && <RemoteStep {...props} />}
      </div>
      <div className="cloud-actions">
        {back && <button type="button" onClick={goBack}>Back</button>}
        <button type="button" className="cloud-spine-later" onClick={onDone}>Finish later</button>
      </div>
    </section>
  );
}

function StepList({ state }: { state: SpineState }) {
  return (
    <ol className="cloud-spine-steps" aria-label="Steps">
      {STEPS.map((id: StepId) => {
        const outcome = state.outcomes[id];
        const current = !state.finished && state.step === id;
        const mark = MARKS[current ? 'current' : outcome ?? 'ahead'];
        return (
          <li key={id} aria-current={current ? 'step' : undefined} data-outcome={outcome ?? (current ? 'current' : 'ahead')}>
            <Icon name={mark.icon} size="compact" />
            <span>{STEP_TITLES[id]}</span>
            <span className="cloud-spine-sr">, {mark.words}</span>
          </li>
        );
      })}
    </ol>
  );
}
