import { useEffect, useMemo, useRef, useState } from 'react';
import { clockTime, playbackStatusText } from '../../copy';
import type { ImportEvent, ImportSource } from '../../media';
import { Icon, IconName } from '../../ui/Icon';
import { AudioSession, defaultDeps, SpineDeps } from './deps';
import { FRESH, loadState, saveState, SpineState, STEP_TITLES, StepId, StepOutcome, STEPS } from './state';
import { CapabilityStep, ConnectStep, ImportProgress, KeepAwakeStep, OutputStep, RemoteStep, SoundcheckStep, StartStep, StepProps, VerifyStep } from './steps';

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
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const audio = useRef<AudioSession | null>(null);
  const importing = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => () => {
    importing.current?.abort();
    audio.current?.dispose();
    audio.current = null;
  }, []);

  // Each step change is saved, and focus moves to the new step's title so keyboard and screen
  // reader users land on what changed (not on the first paint).
  const change = (next: SpineState) => {
    setState(next);
    saveState(deps.storage, workspaceId, next);
  };
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
    importing.current?.abort();
    const controller = new AbortController();
    importing.current = controller;
    const live: ImportProgress = { running: true, done: 0, duplicates: 0, failures: [], paused: false };
    setProgress(live);
    const moved: SpineState = { ...state, step: 'verify', outcomes: { ...state.outcomes, connect: 'done' } };
    change(moved);
    const onProgress = (event: ImportEvent) => {
      if (event.kind === 'file') {
        if (event.stage === 'hashing') live.current = event.name;
        if (event.stage === 'done') { if (event.duplicateOf !== undefined) live.duplicates += 1; else live.done += 1; }
        if (event.stage === 'failed') live.failures = [...live.failures, { name: event.name, reason: event.reason }];
      }
      if (event.kind === 'paused') live.paused = true;
      setProgress({ ...live });
    };
    deps.importMusic(source, onProgress, controller.signal).then((summary) => {
      if (importing.current !== controller) return;
      setProgress({ ...live, running: false, current: undefined });
      const { imported, duplicates, failed, skipped, cancelled, paused } = summary;
      change({ ...moved, imported: { imported, duplicates, failed, skipped, cancelled, paused } });
    }, () => {
      if (importing.current !== controller) return;
      setProgress({ ...live, running: false, current: undefined, error: 'SelectaDJ couldn’t reach your account to add these songs. Check your connection and try again.' });
    });
  };

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
        <h1 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1}>You’re set up</h1>
        <StepList state={state} />
        <p role="status">{status}</p>
        <div className="cloud-actions">
          <button type="button" className="primary" onClick={onDone}>Open SelectaDJ</button>
          <button type="button" onClick={() => change(FRESH)}>Go through it again</button>
        </div>
      </section>
    );
  }

  const step = state.step;
  return (
    <section className="cloud-spine" aria-labelledby={`spine-${workspaceId}-title`}>
      <p className="cloud-eyebrow">GETTING STARTED · STEP {STEPS.indexOf(step) + 1} OF {STEPS.length}</p>
      <h1 id={`spine-${workspaceId}-title`} ref={heading} tabIndex={-1}>{STEP_TITLES[step]}</h1>
      <StepList state={state} />
      <div className="cloud-card cloud-spine-step" data-step={step}>
        {step === 'connect' && <ConnectStep {...props} onPick={startImport} />}
        {step === 'verify' && <VerifyStep {...props} progress={progress} onStop={() => importing.current?.abort()} />}
        {step === 'capability' && <CapabilityStep {...props} />}
        {step === 'output' && <OutputStep {...props} />}
        {step === 'start' && <StartStep {...props} />}
        {step === 'soundcheck' && <SoundcheckStep {...props} />}
        {step === 'keepawake' && <KeepAwakeStep {...props} />}
        {step === 'remote' && <RemoteStep {...props} />}
      </div>
      <button type="button" className="cloud-spine-later" onClick={onDone}>Finish later</button>
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
