import { ChangeEvent, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { playbackStatusText } from '../../copy';
import { success } from '../../feel/haptics';
import { NumberRoll } from '../../feel/numberRoll';
import { feelOn, onFeelChange } from '../../feel/root';
import type { ImportSource } from '../../media';
import { Icon } from '../../ui/Icon';
import { Meter } from '../../ui/Meter';
import { useFlag } from '../../flags';
import type { ImportSnapshot } from '../importSession';
import { carryOnNow } from '../importResume';
import { CancelImportButton, checkedOf, ImportProgressLine, ResumeOfferNotice } from '../ImportStatus';
import type { AudioSession, SpineDeps, WakeSentinel } from './deps';
import { forkToController, ImportTally, OutputRoute, settle, skipPlayback, SpineState } from './state';
import { reuseWords } from '../importAnnouncer';

/** The steps of the onboarding spine (ADR-0463). Each one says plainly what is happening and
 * what is not, and records its own outcome through `onChange`. No step says install, upload or
 * wait for processing: the music stays on this device and is checked here. */

export type StepProps = {
  state: SpineState;
  onChange: (next: SpineState) => void;
  deps: SpineDeps;
  /** The audio session opened by a press in an earlier step, if any. */
  session: () => AudioSession | null;
  /** Opens audio from inside the current press; a string is why this device cannot. */
  openSession: () => AudioSession | string;
};

function SkipButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <button type="button" className="cloud-spine-skip" onClick={onClick}>{children}</button>;
}

/* ---------- connect ---------- */

export function ConnectStep({ state, onChange, deps, onPick, workspaceId }: StepProps & { onPick: (source: ImportSource) => void; workspaceId?: string }) {
  const id = useId();
  const picker = deps.pickers.dirPicker();
  const folderInput = deps.pickers.directoryInput();
  const [problem, setProblem] = useState('');
  const fromInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length) onPick(Array.from(files));
  };
  const pickFolder = async () => {
    setProblem('');
    try {
      const folder = await deps.pickers.pickDirectory?.();
      if (folder) onPick(folder);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setProblem('SelectaDJ could not open that folder. Try choosing your music files instead.');
    }
  };
  return (
    <>
      <p>Choose the music you want to mix. It stays on this device: SelectaDJ reads it here and keeps only its details, like titles and lengths, in your account.</p>
      {/* cloud.resilient_import: an interrupted import, with its one next step */}
      {workspaceId && <ResumeOfferNotice workspaceId={workspaceId} />}
      <div className="cloud-actions">
        <label className="cloud-spine-pick primary" htmlFor={`${id}-files`}>
          <Icon name="music" size="toolbar" /> Choose music files
          <input id={`${id}-files`} className="visually-hidden" type="file" multiple accept="audio/*" onChange={fromInput} />
        </label>
        {picker.supported
          ? <button type="button" onClick={() => void pickFolder()}><Icon name="folder" size="toolbar" /> Choose a folder</button>
          : folderInput.supported && (
            <label className="cloud-spine-pick" htmlFor={`${id}-folder`}>
              <Icon name="folder" size="toolbar" /> Choose a folder
              <input id={`${id}-folder`} className="visually-hidden" type="file" multiple onChange={fromInput} {...{ webkitdirectory: '' }} />
            </label>
          )}
      </div>
      {!picker.supported && !folderInput.supported && picker.reason && <p className="cloud-hint">{picker.reason}</p>}
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
      <SkipButton onClick={() => onChange({ ...settle(state, 'connect', 'skipped'), outcomes: { ...state.outcomes, connect: 'skipped', verify: 'skipped' }, step: 'capability' })}>
        Look around first, connect music later
      </SkipButton>
    </>
  );
}

/* ---------- verify ---------- */

export type VerifyProps = StepProps & {
  /** The import session's live snapshot (cloud/importSession.ts). */
  live: ImportSnapshot;
  /** `cloud.progressive_import`: the member may carry on while checking continues. */
  earlyContinue: boolean;
  onStop: () => void;
  /** Move on without settling verify; the finished import settles it later. */
  onContinueEarly: () => void;
};

/** Never blocking: while the import runs, the member sees honest counts and may carry on. */
export function VerifyStep({ state, onChange, live, earlyContinue, onStop, onContinueEarly }: VerifyProps) {
  const resilient = useFlag('cloud.resilient_import');
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  if (live.phase === 'running' && resilient) {
    const known = typeof live.total === 'number';
    const checked = checkedOf(live);
    return (
      <>
        <p>SelectaDJ is reading each song on this device to recognise it by its contents. Your files are not changed or moved. If this tab closes, the import carries on from where it got to next time.</p>
        <Meter
          className="cloud-spine-progress"
          label="Checking your music"
          showLabel={false}
          value={known ? checked : undefined}
          max={known ? Math.max(live.total ?? 0, 1) : undefined}
          valueText={known ? `${checked} of ${live.total} files` : undefined}
        />
        <ImportProgressLine live={live} className="cloud-actions" />
        {live.current && !live.elsewhere && <p className="cloud-hint" dir="auto">Now: {live.current}</p>}
        <div className="cloud-actions">
          {earlyContinue && <button type="button" className="primary" onClick={onContinueEarly}>Continue while it finishes</button>}
          <CancelImportButton label="Stop here" />
        </div>
      </>
    );
  }
  if (live.phase === 'failed' && resilient) {
    return (
      <>
        <p className="cloud-inline-error" role="alert">{live.error ?? 'The import stopped part way. Everything already checked is kept, and it carries on from there.'}</p>
        <div className="cloud-actions">
          {/* a remembered folder carries on at once (connect then shows its progress); picked files
              are asked for again on connect, where the offer says why */}
          <button type="button" className="primary" onClick={() => { carryOnNow(); onChange({ ...state, step: 'connect' }); }}>Try again</button>
          <SkipButton onClick={() => onChange(settle(state, 'verify', 'skipped'))}>Carry on without it</SkipButton>
        </div>
      </>
    );
  }
  if (live.phase === 'running') {
    const known = typeof live.total === 'number';
    return (
      <>
        <p>SelectaDJ is reading each song on this device to recognise it by its contents. Your files are not changed or moved.</p>
        {/* the count updates silently; milestones are announced once by useImportAnnouncer */}
        <Meter
          className="cloud-spine-progress"
          label="Checking your music"
          showLabel={false}
          value={known ? live.registered : undefined}
          max={known ? Math.max(live.total ?? 0, 1) : undefined}
          valueText={known ? `${live.registered} of ${live.total} songs` : undefined}
        />
        {/* with motion on (ADR-0477) the real count rolls to each new value; off, the same words */}
        <p>
          {moving
            ? <><NumberRoll value={live.registered} />{known ? ` of ${live.total} checked so far. You can keep going; checking continues in the background.` : ' checked so far. SelectaDJ is still counting the files in that folder.'}</>
            : known
              ? `${live.registered} of ${live.total} checked so far. You can keep going; checking continues in the background.`
              : `${live.registered} checked so far. SelectaDJ is still counting the files in that folder.`}
        </p>
        {live.current && <p className="cloud-hint" dir="auto">Now: {live.current}</p>}
        <div className="cloud-actions">
          {earlyContinue && <button type="button" className="primary" onClick={onContinueEarly}>Continue while it finishes</button>}
          <button type="button" onClick={onStop}>Stop here</button>
        </div>
      </>
    );
  }
  if (live.phase === 'failed') {
    return (
      <>
        <p className="cloud-inline-error" role="alert">SelectaDJ couldn’t reach your account to add these songs. Check your connection and try again.</p>
        <p>Anything already checked is in your library.</p>
        <div className="cloud-actions">
          <button type="button" className="primary" onClick={() => onChange({ ...state, step: 'connect' })}>Try again</button>
          <SkipButton onClick={() => onChange(settle(state, 'verify', 'skipped'))}>Carry on without it</SkipButton>
        </div>
      </>
    );
  }
  // finished or paused: the session's own summary; a paused run without one reads its counts;
  // idle (a resumed visit): the tally saved when the import finished
  const summary: ImportTally | undefined = live.summary
    ?? (live.phase === 'paused'
      ? { imported: live.imported, duplicates: live.duplicates, failed: live.failures.length, skipped: live.skipped, cancelled: false, paused: true }
      : state.imported);
  if (!summary) {
    return (
      <>
        <p>Nothing is being checked right now.</p>
        <div className="cloud-actions">
          <button type="button" className="primary" onClick={() => onChange({ ...state, step: 'connect' })}>Choose music</button>
          <SkipButton onClick={() => onChange(settle(state, 'verify', 'skipped'))}>Carry on without music</SkipButton>
        </div>
      </>
    );
  }
  // extra copies of a song are one song, so they are said apart, never counted as songs
  const added = summary.imported;
  return (
    <>
      <p role="status">
        {added === 0 ? 'No songs were added.' : added === 1 ? '1 song is in your library.' : `${added} songs are in your library.`}
        {summary.duplicates ? ` ${summary.duplicates} more ${summary.duplicates === 1 ? 'file was an extra copy' : 'files were extra copies'} of songs you already have.` : ''}
        {summary.failed ? ` ${summary.failed} could not be read.` : ''}
        {summary.skipped ? ` ${summary.skipped} files were not music and were left alone.` : ''}
        {reuseWords(summary) ? ` ${reuseWords(summary)}` : ''}
      </p>
      {summary.cancelled && <p>You stopped part way. Everything checked before that is in your library.</p>}
      {summary.paused && <p>This browser ran out of room for its notes about your music. Everything checked so far is in your library; free some space and add the rest later.</p>}
      {live.failures.length > 0 && (
        <ul className="cloud-spine-failures">
          {live.failures.slice(0, 20).map((failure, index) => <li key={`${failure.name}-${index}`}><b dir="auto">{failure.name}</b> <span>{failure.reason}</span></li>)}
        </ul>
      )}
      <div className="cloud-actions">
        {added > 0
          ? <button type="button" className="primary" onClick={() => onChange(settle(state, 'verify', 'done'))}>Continue</button>
          : <button type="button" className="primary" onClick={() => onChange({ ...state, step: 'connect' })}>Choose other music</button>}
        {added === 0 && <SkipButton onClick={() => onChange(settle(state, 'verify', 'skipped'))}>Carry on without music</SkipButton>}
      </div>
    </>
  );
}

/* ---------- capability ---------- */

export function CapabilityStep({ state, onChange, openSession }: StepProps) {
  const [checking, setChecking] = useState(false);
  const check = () => {
    const opened = openSession();
    if (typeof opened === 'string') {
      onChange(forkToController(state, opened));
      return;
    }
    setChecking(true);
    void opened.probe().then((answer) => {
      setChecking(false);
      if (answer.ok) onChange(settle(state, 'capability', 'done', { capability: { ok: true } }));
      else onChange(forkToController(state, answer.reason ?? 'this device did not pass the check.'));
    }, (error: unknown) => {
      setChecking(false);
      onChange(forkToController(state, (error as Error)?.message || 'the check stopped part way.'));
    });
  };
  return (
    <>
      <p>SelectaDJ mixes right here in your browser. This checks that this device can really run the mixer. It takes a couple of seconds and makes no sound.</p>
      {checking
        ? <p role="status" aria-busy="true">Checking this device…</p>
        : <button type="button" className="primary" onClick={check}>Check this device</button>}
      {!checking && <SkipButton onClick={() => onChange(skipPlayback(state))}>Not on this device</SkipButton>}
    </>
  );
}

/* ---------- output ---------- */

export const OUTPUT_ROUTES: { id: OutputRoute; label: string; about: string }[] = [
  { id: 'built_in', label: 'This device’s own speaker', about: 'Fine for checking. Usually too quiet for a room.' },
  { id: 'headphones', label: 'Headphones, or a cable to a speaker', about: '3.5 mm or USB-C. Plug it in before you start sound.' },
  { id: 'bluetooth', label: 'A Bluetooth speaker', about: 'Pair it in this device’s settings first. If it drops, SelectaDJ stops calling the sound confirmed until you check again.' },
  { id: 'hdmi_dock', label: 'HDMI or a dock', about: 'The sound goes wherever the screen or dock sends it, so check that end isn’t muted.' },
  { id: 'system', label: 'This device’s current output (recommended)', about: 'SelectaDJ uses the output already selected in your device settings. It will not change that setting.' },
];

export function OutputStep({ state, onChange }: StepProps) {
  const id = useId();
  const [route, setRoute] = useState<OutputRoute>(state.output ?? 'system');
  return (
    <>
      <p>SelectaDJ uses the sound output your device has already selected. Keep the recommended default unless you want more specific troubleshooting tips; change the speaker itself in your device settings.</p>
      <fieldset className="cloud-spine-routes">
        <legend>What sound output is this device using?</legend>
        {OUTPUT_ROUTES.map((option) => (
          <label key={option.id} className="cloud-check">
            <input type="radio" name={`${id}-route`} value={option.id} checked={route === option.id} onChange={() => setRoute(option.id)} />
            <span><b>{option.label}</b><small>{option.about}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => onChange(settle(state, 'output', 'done', { output: route }))}>Continue</button>
        {/* "whatever is set" is the system route, the same choice as the recommended default, so it
            records the same outcome rather than a skip of that choice */}
        <SkipButton onClick={() => onChange(settle(state, 'output', 'done', { output: 'system' }))}>Use whatever is set</SkipButton>
      </div>
    </>
  );
}

/* ---------- start ---------- */

export function StartStep({ state, onChange, session, openSession }: StepProps) {
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const start = () => {
    const opened = session() ?? openSession();
    if (typeof opened === 'string') {
      onChange(forkToController(state, opened));
      return;
    }
    setProblem('');
    setStarting(true);
    void opened.wake().then((running) => {
      setStarting(false);
      if (running) onChange(settle(state, 'start', 'done'));
      else setProblem('The browser did not let sound start. Make sure this tab is in front, then press Start sound again.');
    }, () => {
      setStarting(false);
      setProblem('The browser did not let sound start. Make sure this tab is in front, then press Start sound again.');
    });
  };
  return (
    <>
      <p>Browsers only let a page make sound after a press. Press Start sound and SelectaDJ gets ready to play. Nothing plays yet.</p>
      <button type="button" className="primary cloud-spine-start" onClick={start} aria-busy={starting || undefined}>
        <Icon name="play" /> {starting ? 'Starting…' : 'Start sound'}
      </button>
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
    </>
  );
}

/* ---------- sound check ---------- */

export const ROUTE_CHECKS: Record<OutputRoute | 'any', string[]> = {
  any: ['Turn the volume up on this device, and check it isn’t muted or on silent.', 'Check this tab isn’t muted in the browser.'],
  built_in: ['Unplug any headphones, so the sound comes out of the device itself.'],
  headphones: ['Push the plug all the way in, or try the other port.', 'Check the speaker at the other end is on and turned up.'],
  bluetooth: ['Check the speaker shows as connected in this device’s Bluetooth settings.', 'Turn the speaker itself up; it has its own volume.'],
  hdmi_dock: ['Check the screen or dock isn’t muted and is on the right input.'],
  system: ['Open the device’s sound settings and check which output it uses.'],
};

export function SoundcheckStep({ state, onChange, deps, session, openSession }: StepProps) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'asking' | 'heard_nothing'>('ready');
  const [problem, setProblem] = useState('');
  const play = () => {
    const opened = session() ?? openSession();
    if (typeof opened === 'string') {
      onChange(forkToController(state, opened));
      return;
    }
    setProblem('');
    setPhase('playing');
    void opened.playTone().then(() => setPhase('asking'), () => {
      setPhase('asking');
      setProblem('The tone may not have played. Press Play the check tone again, or say what you heard.');
    });
  };
  const heard = () => {
    const at = deps.now();
    // a person heard it: the phone answers with the success tap (a no-op where it cannot buzz)
    success();
    session()?.confirmHeard(at);
    onChange(settle(state, 'soundcheck', 'done', { heardAt: at }));
  };
  const heardNothing = () => {
    session()?.markUnverified();
    setPhase('heard_nothing');
  };
  const checks = [...ROUTE_CHECKS.any, ...ROUTE_CHECKS[state.output ?? 'system']];
  return (
    <>
      <p>Play a short, quiet tone, then say whether you heard it. Only a person can tell: SelectaDJ can’t hear the room, so it never marks this done by itself.</p>
      <p className="cloud-spine-status" role="status">{playbackStatusText({ state: 'output_unverified' })}</p>
      {phase === 'playing'
        ? <p aria-busy="true">Playing the check tone…</p>
        : <button type="button" className={phase === 'ready' ? 'primary' : ''} onClick={play}><Icon name="volume" size="toolbar" /> {phase === 'ready' ? 'Play the check tone' : 'Play the tone again'}</button>}
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
      {phase === 'asking' && (
        <div className="cloud-actions" role="group" aria-label="Did you hear the tone?">
          <button type="button" className="primary" onClick={heard}><Icon name="check" size="toolbar" /> I heard it</button>
          <button type="button" onClick={heardNothing}>I heard nothing</button>
        </div>
      )}
      {phase === 'heard_nothing' && (
        <section className="cloud-spine-routes-help" aria-label="Find the sound">
          <h3>Let’s find the sound</h3>
          <ol>{checks.map((check) => <li key={check}>{check}</li>)}</ol>
          <p>Then play the tone again. If it still doesn’t come through, you can carry on: SelectaDJ will keep saying the sound isn’t confirmed until someone hears it.</p>
          <SkipButton onClick={() => onChange(settle(state, 'soundcheck', 'unverified'))}>Carry on without a confirmed sound</SkipButton>
        </section>
      )}
    </>
  );
}

/* ---------- keep awake ---------- */

export function KeepAwakeStep({ state, onChange, deps, session }: StepProps) {
  const [answer, setAnswer] = useState<'held' | 'unsupported' | 'refused' | undefined>();
  const [reason, setReason] = useState('');
  const [held, setHeld] = useState<WakeSentinel | null>(null);
  useEffect(() => () => { void held?.release().catch(() => undefined); }, [held]);
  const ask = async () => {
    const got = await deps.requestWakeLock();
    setAnswer(got.result);
    if (got.result === 'held') {
      setHeld(got.sentinel);
      session()?.watchWakeLock?.(got.sentinel);
    }
    if (got.result === 'refused') setReason(got.reason);
  };
  const words = {
    held: 'The browser agreed to keep the screen on while this page is open and in front. It can still change its mind, for example on low battery, and SelectaDJ will say so.',
    unsupported: 'This browser can’t keep the screen on by itself. Turn off auto-lock in the device’s settings instead.',
    refused: `The browser said no${reason ? `: ${reason.replace(/[.\s]*$/, '')}.` : '.'} Turn off auto-lock in the device’s settings instead.`,
  };
  return (
    <>
      <p>A browser can only play while it’s open and in front. For a long session:</p>
      <ul className="cloud-spine-guidance">
        <li>Plug this device into power.</li>
        <li>Keep SelectaDJ open and in front. If you switch apps or the screen locks, the music stops.</li>
        <li>Turn off auto-lock in the device’s settings, or ask the browser below.</li>
      </ul>
      {answer
        ? <p role="status">{words[answer]}</p>
        : <button type="button" onClick={() => void ask()}>Ask to keep the screen on</button>}
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => onChange(settle(state, 'keepawake', answer === 'held' ? 'done' : 'skipped', answer ? { wakeLock: answer } : {}))}>Continue</button>
      </div>
    </>
  );
}

/* ---------- remote ---------- */

export function RemoteStep({ state, onChange }: StepProps) {
  const failed = state.capability?.ok === false;
  return (
    <>
      {failed && (
        <section className="cloud-spine-fork" aria-label="This device can be your controller">
          <h3><Icon name="warning" size="toolbar" /> This device can’t play the mix</h3>
          <p>{state.capability?.reason}</p>
          <p>You can still use it to look through your library, make mixes and control a player on another device. A tablet or computer whose browser passes this check can be the player; opening SelectaDJ in the browser itself, rather than inside another app, often helps.</p>
        </section>
      )}
      <p>Want to control the music from your phone? Open Devices from More, then pair your phone there. It’s optional, and you can do it any time.</p>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={() => onChange(settle(state, 'remote', 'skipped'))}>Finish</button>
      </div>
    </>
  );
}
