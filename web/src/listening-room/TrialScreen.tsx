import { useEffect, useId, useRef } from 'react';
import { Field } from '../ui/primitives';
import type { Progress } from './audition';
import { allowedVerdicts, LABELS, NOTE_LIMIT, REASONS, VERDICTS, type Answer, type Label, type Reason, type Trial, type Verdict } from './session';

/** One transition, heard two ways (tools.listening_room). Presentational: what plays and what is
 * saved is the page's (ListeningRoom.tsx), so the keyboard flow is tested with the sound mocked.
 *
 * Keys: Space plays or pauses; 1 or A plays A, 2 or B plays B; Q W E R T choose a verdict; Enter or
 * the right arrow goes on once there is a verdict; the left arrow goes back. They are ignored while
 * typing a note, and a focused button keeps Space and Enter for itself. */

export type Listening = {
  /** The variant playing, paused or loading, or null. */
  label: Label | null;
  progress: Progress | null;
  /** The trial is being prepared (decoded, measured, planned). */
  preparing: boolean;
  /** The variant heard last, which Replay plays again. */
  last: Label | null;
};

export type TrialScreenProps = {
  trial: Trial;
  answer: Answer;
  number: number;
  count: number;
  /** What the go-on button says: Next, or See the results when nothing else is open. */
  nextWords?: string;
  listening: Listening;
  /** The mix is playing on this device, so nothing here may make a sound until it is paused. */
  blocked?: boolean;
  onPlay(label: Label): void;
  onToggle(): void;
  onReplay(): void;
  onVerdict(verdict: Verdict): void;
  onReason(reason: Reason): void;
  onNote(note: string): void;
  onBack(): void;
  onSkip(): void;
  onNext(): void;
  onStop(): void;
};

const KEYS: Record<string, Verdict> = Object.fromEntries(VERDICTS.map((verdict) => [verdict.key.toLowerCase(), verdict.id]));
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(target.tagName));
const pressable = (target: EventTarget | null) => target instanceof HTMLElement && ['BUTTON', 'A', 'SUMMARY'].includes(target.tagName);
const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function PlayButton({ label, listening, disabled, onPress }: { label: Label; listening: Listening; disabled: boolean; onPress(): void }) {
  const mine = listening.label === label;
  const progress = mine ? listening.progress : null;
  const phase = mine ? progress?.phase ?? 'loading' : null;
  const fill = progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.elapsed / progress.total)) : 0;
  const mark = progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.mark / progress.total)) : null;
  const state = phase === 'playing' ? 'Playing' : phase === 'paused' ? 'Paused' : phase === 'loading' ? 'Getting ready' : 'Play';
  const passed = !!progress && progress.elapsed >= progress.mark;
  const said = progress
    ? `${clock(progress.elapsed)} of ${clock(progress.total)}${progress.markKnown ? `, transition at ${clock(progress.mark)}` : ''}`
    : '';
  return (
    <button
      type="button"
      className="lr-play"
      data-state={phase ?? 'idle'}
      aria-pressed={mine && phase === 'playing'}
      aria-keyshortcuts={label === 'A' ? '1 A' : '2 B'}
      disabled={disabled}
      onClick={onPress}
    >
      <span className="lr-play-letter" aria-hidden="true">{label}</span>
      <span className="lr-play-words">
        <span className="visually-hidden">Version {label}: </span>
        <span>{state}</span>
        <span className="lr-play-time" aria-hidden={!progress || undefined}>{said}</span>
      </span>
      <span className="lr-track" aria-hidden="true">
        <span className="lr-track-fill" style={{ inlineSize: `${fill * 100}%` }} />
        {mark !== null && <span className="lr-track-mark" data-known={progress?.markKnown ? 'yes' : 'no'} data-passed={passed ? 'yes' : 'no'} style={{ insetInlineStart: `${mark * 100}%` }} />}
      </span>
    </button>
  );
}

export function TrialScreen(props: TrialScreenProps) {
  const { trial, answer, number, count, listening, blocked = false } = props;
  const latest = useRef(props);
  latest.current = props;
  const verdicts = allowedVerdicts(answer);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // a new trial starts with focus on its heading, so a screen reader hears which songs it is
  useEffect(() => { heading.current?.focus(); }, [trial.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return;
      const now = latest.current;
      const key = event.key.toLowerCase();
      const own = pressable(event.target);
      let handled = true;
      if (key === ' ' || key === 'spacebar') {
        if (own) return;
        if (!now.blocked) now.onToggle();
      } else if (key === '1' || key === 'a') {
        if (!now.blocked) now.onPlay('A');
      } else if (key === '2' || key === 'b') {
        if (!now.blocked) now.onPlay('B');
      } else if (KEYS[key]) {
        if (allowedVerdicts(now.answer).includes(KEYS[key])) now.onVerdict(KEYS[key]);
      } else if (key === 'enter' || key === 'arrowright') {
        if (key === 'enter' && own) return;
        if (now.answer.verdict) now.onNext();
      } else if (key === 'arrowleft') {
        if (now.number > 1) now.onBack();
      } else handled = false;
      if (handled) event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const press = (label: Label) => (listening.label === label ? props.onToggle() : props.onPlay(label));
  const status = blocked
    ? 'Pause your mix to listen here.'
    : listening.preparing && !listening.label ? 'Getting this transition ready' : listening.label ? '' : 'Press A or B to listen.';

  return (
    <section className="lr-trial" aria-labelledby={headingId}>
      <div className="lr-trial-top">
        <p className="lr-count" aria-live="off">{number} of {count}</p>
        <button type="button" className="lr-quiet" onClick={props.onStop}>Stop for now</button>
      </div>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="lr-pair">
        <span className="lr-song"><b>{trial.from.title}</b>{trial.from.artist && <span className="lr-artist">{trial.from.artist}</span>}</span>
        <span className="lr-into">into</span>
        <span className="lr-song"><b>{trial.to.title}</b>{trial.to.artist && <span className="lr-artist">{trial.to.artist}</span>}</span>
      </h2>

      <div className="lr-plays" role="group" aria-label="Listen">
        {LABELS.map((label) => <PlayButton key={label} label={label} listening={listening} disabled={blocked || !!answer.failed} onPress={() => press(label)} />)}
      </div>
      <div className="lr-under-plays">
        <p className="lr-status" role="status">{answer.failed ? `This transition could not be played here: ${answer.failed}` : status}</p>
        <button type="button" className="lr-quiet" disabled={blocked || !!answer.failed || !(listening.label ?? listening.last)} onClick={props.onReplay}>Replay</button>
      </div>
      <p className="lr-heard">Heard A {answer.replays.A} {answer.replays.A === 1 ? 'time' : 'times'}, B {answer.replays.B} {answer.replays.B === 1 ? 'time' : 'times'}</p>

      <fieldset className="lr-verdicts">
        <legend>Which sounds better?</legend>
        <div className="lr-verdict-row">
          {VERDICTS.filter((verdict) => verdicts.includes(verdict.id)).map((verdict) => (
            <button
              key={verdict.id}
              type="button"
              className="lr-verdict"
              aria-pressed={answer.verdict === verdict.id}
              aria-keyshortcuts={verdict.key}
              onClick={() => props.onVerdict(verdict.id)}
            >
              <span>{verdict.words}</span>
              <kbd aria-hidden="true">{verdict.key}</kbd>
            </button>
          ))}
        </div>
      </fieldset>

      {!answer.failed && (
        <fieldset className="lr-reasons">
          <legend>What did you hear? <span className="lr-optional">Optional, choose any</span></legend>
          <div className="chips">
            {REASONS.map((reason) => (
              <label className="choice lr-chip" key={reason.id}>
                <input type="checkbox" checked={answer.reasons.includes(reason.id)} onChange={() => props.onReason(reason.id)} />
                {reason.words}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Note" help={`Optional, up to ${NOTE_LIMIT} characters.`} className="lr-note">
        {(field) => <textarea {...field} rows={2} maxLength={NOTE_LIMIT} value={answer.note} onChange={(event) => props.onNote(event.target.value)} />}
      </Field>

      <nav className="lr-nav" aria-label="Transitions">
        <button type="button" disabled={number <= 1} onClick={props.onBack}>Back</button>
        <button type="button" className="lr-quiet" onClick={props.onSkip}>Skip for now</button>
        <button type="button" className="primary" disabled={!answer.verdict} onClick={props.onNext}>{props.nextWords ?? 'Next'}</button>
      </nav>
      <p className="lr-keys" aria-hidden="true">
        <span><kbd>Space</kbd> play or pause</span>
        <span><kbd>1</kbd> <kbd>2</kbd> A or B</span>
        <span><kbd>Q</kbd> to <kbd>T</kbd> answer</span>
        <span><kbd>Enter</kbd> next</span>
        <span><kbd>Left arrow</kbd> back</span>
      </p>
    </section>
  );
}
