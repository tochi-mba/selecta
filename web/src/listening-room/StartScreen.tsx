import { Slider } from '../ui/primitives';
import type { Progress } from './audition';
import { answeredCount, SECONDS_PER_TRIAL, type Session } from './session';

/** The Listening Room's first screen: what this session is, how long it takes, a level check and
 * Start (or Carry on). Every sound starts from a press here, which is also what opens the audio. */
export function StartScreen({ session, resumed, check, volume, blocked, problem, opening, onCheck, onVolume, onStart, onNew, onPauseMix }: {
  session: Session;
  /** The session was saved in this browser and is being carried on. */
  resumed: boolean;
  check: Progress | null;
  volume: number;
  blocked: boolean;
  problem: string;
  opening: boolean;
  onCheck(): void;
  onVolume(volume: number): void;
  onStart(): void;
  onNew(): void;
  onPauseMix(): void;
}) {
  const count = session.trials.length;
  const answered = answeredCount(session);
  const minutes = Math.max(1, Math.round((count * SECONDS_PER_TRIAL) / 60));
  const checking = !!check;
  return (
    <section className="lr-start" aria-labelledby="lr-start-title">
      <h2 id="lr-start-title" className="lr-start-title">
        {resumed ? 'Carry on listening' : 'Listen for the better transition'}
      </h2>
      <p className="lr-lead">
        You’ll hear {count} {count === 1 ? 'transition' : 'transitions'} from {session.mixName ? <b>{session.mixName}</b> : 'your current mix'}, each played two ways as A and B, and say which sounds better. You won’t know which is which until the end.
      </p>
      <dl className="lr-facts">
        <div><dt>Transitions</dt><dd>{count}</dd></div>
        <div><dt>Time</dt><dd>About {minutes} {minutes === 1 ? 'minute' : 'minutes'}</dd></div>
        {resumed && <div><dt>Answered</dt><dd>{answered} of {count}</dd></div>}
      </dl>
      <p className="lr-hint">Headphones or good speakers in a quiet room help. Your answers stay in this browser.</p>

      {blocked && (
        <div className="lr-blocked" role="status">
          <p>Your mix is playing on this device. The Listening Room needs the sound to itself.</p>
          <button type="button" onClick={onPauseMix}>Pause the mix</button>
        </div>
      )}

      <div className="lr-level">
        <h3 className="lr-small-title">Set a comfortable volume</h3>
        <p className="lr-hint">Play a few seconds of the first song, then set the volume here or on your device. It stays the same for every transition.</p>
        <div className="lr-level-row">
          <button type="button" disabled={blocked || opening} aria-pressed={checking} onClick={onCheck}>
            {checking ? 'Stop the level check' : 'Play a level check'}
          </button>
          <label className="lr-volume">
            <span>Volume</span>
            <Slider label="Volume" min={0} max={100} step={1} value={Math.round(volume * 100)} valueText={`${Math.round(volume * 100)} percent`} onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)} />
          </label>
        </div>
        <p className="lr-status" role="status">{check ? (check.phase === 'loading' ? 'Getting the song ready' : 'Playing the level check') : ''}</p>
      </div>

      {problem && <p className="warn" role="alert">{problem}</p>}
      <div className="lr-start-actions">
        <button type="button" className="primary big" disabled={blocked || opening} aria-busy={opening || undefined} onClick={onStart}>
          {opening ? 'Opening the sound' : resumed ? 'Carry on' : 'Start'}
        </button>
        {resumed && <button type="button" className="lr-quiet" onClick={onNew}>Start a new session</button>}
      </div>
    </section>
  );
}
