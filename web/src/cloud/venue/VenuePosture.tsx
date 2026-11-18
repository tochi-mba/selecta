import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, IconName } from '../../ui/Icon';
import { InstallOffer } from '../InstallOffer';
import type { AudioSession, WakeSentinel } from '../onboarding/deps';
import type { OutputRoute } from '../onboarding/state';
import { OUTPUT_ROUTES, ROUTE_CHECKS } from '../onboarding/steps';
import { qualification } from './capabilityRecord';
import { defaultVenueDeps, loadLastHeard, saveLastHeard, saveRecord, VenueDeps } from './deps';
import { FallbackContext, isVenueDeepLink, preflight } from './fallback';
import { freshPosture, Posture, PostureEvent, reduce, VENUE_STEP_TITLES, VENUE_STEPS, venueStatus, VenueStep } from './posture';
import { idleLongEnough } from './soundCheckTruth';
import { VenueFallback } from './VenueFallback';

/** The single-tablet venue posture flow behind `cloud.venue_tablet` (ADR-0460, BF-0460-02).
 *
 * Check this tablet, plug in, keep the screen on, choose the speaker, Start, hear the check tone,
 * then a status board that only says "Sound confirmed" while a person's confirmation still stands.
 * Every posture loss (hidden tab, wake lock released, battery, a call, a route change, idle) moves
 * the status down with the fix named, and a re-check is offered. A device that cannot play gets
 * the controller, guest and library fallbacks with the reason (BF-0460-07). `deps` is for tests.
 */
export function VenuePosture({ workspaceId, places, deps: given }: {
  workspaceId: string;
  places: FallbackContext;
  deps?: Partial<VenueDeps>;
}) {
  const deps = useMemo<VenueDeps>(() => ({ ...defaultVenueDeps(), ...given }), [given]);
  const [posture, setPosture] = useState<Posture>(() => freshPosture(loadLastHeard(deps.storage, workspaceId)));
  const [deepLinked] = useState(() => typeof window !== 'undefined' && isVenueDeepLink(window.location.hash));
  const [early] = useState(() => (deepLinked ? preflight() : { ok: true as const }));
  const session = useRef<AudioSession | null>(null);
  const sentinel = useRef<WakeSentinel | null>(null);
  const lastActivity = useRef(deps.now());
  const section = useRef<HTMLElement>(null);
  const dispatch = (event: PostureEvent) => setPosture((current) => reduce(current, event));
  const titleId = useId();

  // A deep link lands on this panel, read out from its title.
  useEffect(() => {
    if (!deepLinked) return;
    section.current?.scrollIntoView?.({ block: 'start' });
    section.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [deepLinked]);

  useEffect(() => () => {
    void sentinel.current?.release().catch(() => undefined);
    session.current?.dispose();
    session.current = null;
  }, []);

  // The battery, where the browser reports it. Its absence is 'unknown', never 'plugged in'.
  useEffect(() => {
    let live = true;
    let battery: Awaited<ReturnType<VenueDeps['battery']>> = null;
    const read = () => { if (battery && live) dispatch({ type: 'battery', fact: battery.charging ? 'charging' : 'on_battery' }); };
    void deps.battery().then((found) => {
      battery = found;
      read();
      battery?.addEventListener('chargingchange', read);
    });
    return () => { live = false; battery?.removeEventListener('chargingchange', read); };
  }, [deps]);

  const askWake = async () => {
    const answer = await deps.requestWakeLock();
    if (answer.result === 'held') {
      sentinel.current = answer.sentinel;
      answer.sentinel.addEventListener('release', () => {
        if (sentinel.current === answer.sentinel) dispatch({ type: 'wake', fact: 'released' });
      });
      session.current?.watchWakeLock?.(answer.sentinel);
      dispatch({ type: 'wake', fact: 'held' });
    } else {
      dispatch({ type: 'wake', fact: answer.result, reason: answer.result === 'refused' ? answer.reason : undefined });
    }
  };

  // Visibility and output-route changes: the browser's own events, not guesses. Coming back to the
  // front asks for the wake lock again (browsers drop it on hide) but never re-verifies the sound.
  const wakeWanted = posture.wake === 'held' || posture.wake === 'released';
  useEffect(() => {
    const doc = deps.watchDocument;
    const onVisibility = () => {
      if (doc?.visibilityState === 'hidden') { dispatch({ type: 'hidden' }); return; }
      dispatch({ type: 'visible' });
      if (wakeWanted) void askWake();
    };
    const onRoute = () => dispatch({ type: 'route_changed' });
    doc?.addEventListener('visibilitychange', onVisibility);
    deps.watchDevices?.addEventListener('devicechange', onRoute);
    return () => {
      doc?.removeEventListener('visibilitychange', onVisibility);
      deps.watchDevices?.removeEventListener('devicechange', onRoute);
    };
    // askWake reads only refs and deps, so it is left out of the list on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, wakeWanted]);

  // After a long untouched spell, the next touch is a natural boundary: offer a re-check.
  const touched = () => {
    const now = deps.now();
    if (idleLongEnough(lastActivity.current, now) && posture.check.fresh) dispatch({ type: 'idle' });
    lastActivity.current = now;
  };

  const watchSession = (opened: AudioSession) => {
    // Only the move into 'interrupted' is news; the engine's ladder keeps it there until a check.
    let was = opened.engineState?.().output.status;
    opened.subscribe?.((state) => {
      if (state.output.status === 'interrupted' && was !== 'interrupted') dispatch({ type: 'interrupted' });
      was = state.output.status;
    });
    opened.onInterrupted?.(() => dispatch({ type: 'interrupted' }));
    if (sentinel.current) opened.watchWakeLock?.(sentinel.current);
  };
  const openSession = (): AudioSession | string => {
    if (session.current) return session.current;
    const opened = deps.openAudio();
    if (typeof opened !== 'string') { session.current = opened; watchSession(opened); }
    return opened;
  };

  const status = venueStatus(posture);
  const unqualified = !early.ok || posture.probe?.ok === false;
  const reason = !early.ok ? early.reason : posture.probe?.ok === false ? posture.probe.reason : '';

  return (
    <section ref={section} id="venue" className="cloud-card venue-posture" aria-labelledby={titleId} onPointerDown={touched} onKeyDown={touched}>
      <p className="cloud-eyebrow">Venue tablet</p>
      <h2 id={titleId} tabIndex={-1}>Play a venue from this tablet</h2>
      {unqualified ? <VenueFallback reason={reason} places={places} deepLinked={deepLinked} /> : (
        <>
          <p>One tablet, in front, awake and on power, after someone hears the check tone. SelectaDJ cannot play with the screen locked or the browser in the back, and it says so the moment that happens.</p>
          <Steps posture={posture} />
          <div className="cloud-spine-step" data-venue-step={posture.step}>
            <StepBody posture={posture} deps={deps} dispatch={dispatch} openSession={openSession} session={() => session.current} askWake={askWake} workspaceId={workspaceId} />
          </div>
          {posture.probe?.ok && (
            <section className="venue-status" aria-label="Venue status" data-venue-status={status.status}>
              <p role="status"><b>{status.label}.</b> {status.detail}</p>
              {status.problems.length > 0 && (
                <ul className="cloud-spine-guidance">
                  {status.problems.map((problem) => <li key={problem.id} data-problem={problem.id}>{problem.what} <b>{problem.fix}</b></li>)}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

const MARK: Record<'done' | 'current' | 'ahead', { icon: IconName; words: string }> = {
  done: { icon: 'check', words: 'done' },
  current: { icon: 'dot', words: 'now' },
  ahead: { icon: 'circle', words: 'to do' },
};

function Steps({ posture }: { posture: Posture }) {
  const at = VENUE_STEPS.indexOf(posture.step);
  return (
    <ol className="cloud-spine-steps" aria-label="Venue steps">
      {VENUE_STEPS.filter((step) => step !== 'ready').map((step, index) => {
        const mark = MARK[index < at ? 'done' : index === at ? 'current' : 'ahead'];
        return (
          <li key={step} aria-current={index === at ? 'step' : undefined}>
            <Icon name={mark.icon} size="compact" />
            <span>{VENUE_STEP_TITLES[step]}</span>
            <span className="cloud-spine-sr">, {mark.words}</span>
          </li>
        );
      })}
    </ol>
  );
}

type BodyProps = {
  posture: Posture;
  deps: VenueDeps;
  dispatch: (event: PostureEvent) => void;
  openSession: () => AudioSession | string;
  session: () => AudioSession | null;
  askWake: () => Promise<void>;
  workspaceId: string;
};

function StepBody(props: BodyProps) {
  const { posture, dispatch } = props;
  const go = (step: VenueStep) => dispatch({ type: 'go', step });
  switch (posture.step) {
    case 'probe': return <ProbeStep {...props} />;
    case 'power': return <PowerStep {...props} />;
    case 'wake': return <WakeStep {...props} />;
    case 'output': return <OutputChoice {...props} />;
    case 'start': return <StartSound {...props} />;
    case 'soundcheck': return <SoundCheck {...props} />;
    case 'ready': return (
      <div className="cloud-actions">
        <button type="button" onClick={() => go('soundcheck')}>Play the check tone again</button>
        {posture.interrupted && <button type="button" className="primary" onClick={() => go('start')}>Start sound again</button>}
        {posture.wake === 'released' && <button type="button" onClick={() => void props.askWake()}>Keep the screen on again</button>}
      </div>
    );
  }
}

function ProbeStep({ deps, dispatch, openSession, posture, workspaceId }: BodyProps) {
  const [checking, setChecking] = useState(false);
  const check = () => {
    const opened = openSession();
    if (typeof opened === 'string') { dispatch({ type: 'probed', ok: false, reason: opened }); return; }
    setChecking(true);
    const detail = opened.probeDetail ? opened.probeDetail() : opened.probe().then((answer) => (answer.ok
      ? { ok: true as const, sampleRate: 0, schedulingMisses: 0, blocks: 1 }
      : { ok: false as const, state: 'unsupported_here' as const, reason: answer.reason ?? 'this device did not pass the check.' }));
    void detail
      .then((worklet) => deps.runSuite({ worklet, output: posture.route ?? undefined }))
      .then((record) => {
        saveRecord(deps.storage, workspaceId, record);
        const verdict = qualification(record.probes);
        dispatch(verdict.player ? { type: 'probed', ok: true, notes: verdict.notes } : { type: 'probed', ok: false, reason: verdict.reason });
      }, (error: unknown) => dispatch({ type: 'probed', ok: false, reason: (error as Error)?.message || 'the check stopped part way.' }))
      .finally(() => setChecking(false));
  };
  return (
    <>
      <p>This measures what this tablet can really do: the mixer, storage, music formats and speed. It takes a few seconds and makes no sound. Nothing about the brand or model decides it.</p>
      {checking
        ? <p role="status" aria-busy="true">Checking this tablet…</p>
        : <button type="button" className="primary" onClick={check}>Check this tablet</button>}
    </>
  );
}

function PowerStep({ posture, dispatch }: BodyProps) {
  const battery = posture.power.battery;
  return (
    <>
      <p>A venue night is long. Plug this tablet into power before you start.</p>
      {battery === 'charging' && <p role="status">The tablet says it is charging.</p>}
      {battery === 'on_battery' && <p className="cloud-inline-error" role="alert">The tablet says it is running on its battery. Plug it in.</p>}
      {battery === 'unknown' && <p className="cloud-hint">This browser does not say whether the tablet is charging, so SelectaDJ asks you.</p>}
      {/* Installed, the tablet opens SelectaDJ as its own app and keeps its details (plan W5b). */}
      <InstallOffer />
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => dispatch({ type: 'power_confirmed' })}>It’s plugged in</button>
      </div>
    </>
  );
}

function WakeStep({ posture, dispatch, askWake }: BodyProps) {
  const words: Partial<Record<Posture['wake'], string>> = {
    held: 'The browser agreed to keep the screen on while SelectaDJ is open and in front. It can change its mind, on low battery for example, and SelectaDJ will say so.',
    unsupported: 'This browser cannot keep the screen on by itself. Turn off auto-lock in the device settings instead.',
    refused: `The browser said no${posture.wakeReason ? `: ${posture.wakeReason}` : '.'} Turn off auto-lock in the device settings instead.`,
  };
  return (
    <>
      <p>If the screen locks, the music stops. Ask the browser to keep the screen on, and turn off auto-lock in the device settings too.</p>
      {words[posture.wake]
        ? <p role="status">{words[posture.wake]}</p>
        : <button type="button" onClick={() => void askWake()}>Keep the screen on</button>}
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => dispatch({ type: 'wake_done' })}>Continue</button>
      </div>
    </>
  );
}

function OutputChoice({ posture, dispatch }: BodyProps) {
  const id = useId();
  const [route, setRoute] = useState<OutputRoute | null>(posture.route ?? 'system');
  return (
    <>
      <p>SelectaDJ uses the output the tablet has already selected. Keep the recommended default unless you want more specific troubleshooting tips; change the speaker itself in the tablet’s sound settings.</p>
      <fieldset className="cloud-spine-routes">
        <legend>What sound output is this tablet using?</legend>
        {OUTPUT_ROUTES.map((option) => (
          <label key={option.id} className="cloud-check">
            <input type="radio" name={`${id}-route`} value={option.id} checked={route === option.id} onChange={() => setRoute(option.id)} />
            <span><b>{option.label}</b><small>{option.about}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => dispatch({ type: 'route_chosen', route })}>Continue</button>
        <button type="button" className="cloud-spine-skip" onClick={() => dispatch({ type: 'route_chosen', route: null })}>Use whatever is set</button>
      </div>
    </>
  );
}

function StartSound({ dispatch, openSession }: BodyProps) {
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const start = () => {
    const opened = openSession();
    if (typeof opened === 'string') { dispatch({ type: 'probed', ok: false, reason: opened }); return; }
    setProblem('');
    setStarting(true);
    void opened.wake().then((running) => {
      if (running) { dispatch({ type: 'started' }); dispatch({ type: 'resumed' }); }
      else setProblem('The browser did not let sound start. Make sure SelectaDJ is in front, then press Start sound again.');
    }, () => setProblem('The browser did not let sound start. Make sure SelectaDJ is in front, then press Start sound again.'))
      .finally(() => setStarting(false));
  };
  return (
    <>
      <p>Browsers only let a page make sound after a press. Press Start sound to begin the night; nothing plays yet.</p>
      <button type="button" className="primary cloud-spine-start" onClick={start} aria-busy={starting || undefined}>
        <Icon name="play" /> {starting ? 'Starting…' : 'Start sound'}
      </button>
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
    </>
  );
}

function SoundCheck({ posture, deps, dispatch, session, workspaceId }: BodyProps) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'asking' | 'heard_nothing'>('ready');
  const [problem, setProblem] = useState('');
  const play = () => {
    const opened = session();
    if (!opened) { dispatch({ type: 'go', step: 'start' }); return; }
    setProblem('');
    setPhase('playing');
    // a tone that failed to play is said, never passed off as silence in the room
    void opened.playTone().then(() => setPhase('asking'), () => {
      setPhase('asking');
      setProblem('The check tone may not have played. Press Play the tone again, or say what you heard.');
    });
  };
  // The one place output becomes verified: a person pressed this button (ADR-0460).
  const heard = () => {
    const at = deps.now();
    session()?.confirmHeard(at);
    saveLastHeard(deps.storage, workspaceId, at);
    dispatch({ type: 'heard', at });
  };
  const nothing = () => {
    session()?.markUnverified();
    dispatch({ type: 'heard_nothing' });
    setPhase('heard_nothing');
  };
  const checks = [...ROUTE_CHECKS.any, ...ROUTE_CHECKS[posture.route ?? 'system']];
  return (
    <>
      <p>Play a short, quiet tone and listen in the room. Only a person can say it came through: SelectaDJ cannot hear the room, so it never marks this by itself.</p>
      {phase === 'playing'
        ? <p aria-busy="true">Playing the check tone…</p>
        : <button type="button" className={phase === 'ready' ? 'primary' : ''} onClick={play}><Icon name="volume" size="toolbar" /> {phase === 'ready' ? 'Play the check tone' : 'Play the tone again'}</button>}
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
      {phase === 'asking' && (
        <div className="cloud-actions" role="group" aria-label="Did you hear the tone?">
          <button type="button" className="primary" onClick={heard}><Icon name="check" size="toolbar" /> I heard it</button>
          <button type="button" onClick={nothing}>I heard nothing</button>
        </div>
      )}
      {phase === 'heard_nothing' && (
        <section className="cloud-spine-routes-help" aria-label="Find the sound">
          <h3>Let’s find the sound</h3>
          <ol>{checks.map((check) => <li key={check}>{check}</li>)}</ol>
          <p>Then play the tone again. If it still doesn’t come through, you can carry on: the status board keeps saying the sound isn’t confirmed until someone hears it.</p>
          <button type="button" className="cloud-spine-skip" onClick={() => dispatch({ type: 'go', step: 'ready' })}>Carry on without a confirmed sound</button>
        </section>
      )}
    </>
  );
}
