import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { openEngineAudio, type AudioSession } from './onboarding/deps';
import { ROUTE_CHECKS } from './onboarding/steps';

/** The sound check, where Listen says the sound is not confirmed.
 *
 * The notice tells the listener to play the check tone and say whether they heard it; this is
 * that control, beside the words. It is onboarding's own check (the same tone, the same
 * confirmation and the same places to look, from `onboarding/deps` and `onboarding/steps`), so
 * a yes here confirms this device's output for the mix that is playing, and the shell stops
 * drawing this once it has. Only a person can answer: nothing here marks the sound as heard.
 */
export function SoundCheck({ open = openEngineAudio, now = () => Date.now() / 1000 }: {
  /** Opens the audio session from inside a press; a string is why this device cannot. */
  open?: () => AudioSession | string;
  /** Seconds since epoch. */
  now?: () => number;
}) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'asking' | 'heard_nothing'>('ready');
  const [problem, setProblem] = useState('');
  const session = useRef<AudioSession | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { session.current?.dispose(); session.current = null; }, []);
  // the question takes focus when it appears, and the tone button takes it back after a no, so
  // a keyboard or screen reader user is never left on a control that has gone
  useEffect(() => {
    if (phase === 'asking') yes.current?.focus();
    if (phase === 'heard_nothing') playButton.current?.focus();
  }, [phase]);

  const play = () => {
    if (phase === 'playing') return;
    const opened = session.current ?? open();
    if (typeof opened === 'string') {
      setProblem(`The check tone can’t play on this device: ${opened}`);
      return;
    }
    session.current = opened;
    setProblem('');
    setPhase('playing');
    void opened.playTone().then(() => setPhase('asking'), () => {
      setPhase('asking');
      setProblem('The tone may not have played. Play it again, or say what you heard.');
    });
  };
  const heard = () => {
    // every engine on this tab shares the answer, so the playing mix reads as confirmed
    session.current?.confirmHeard(now());
    session.current?.dispose();
    session.current = null;
    setPhase('ready');
  };
  // this only shows while the output is unconfirmed, so a no changes nothing: it stays unconfirmed
  const heardNothing = () => setPhase('heard_nothing');
  const again = phase === 'asking' || phase === 'heard_nothing';
  return (
    <section className="sound-check" aria-label="Sound check">
      <button ref={playButton} type="button" className={again ? undefined : 'primary'} onClick={play} aria-busy={phase === 'playing' || undefined} aria-disabled={phase === 'playing' || undefined}>
        <Icon name="volume" size="toolbar" /> {phase === 'playing' ? 'Playing the check tone…' : again ? 'Play the tone again' : 'Play check tone'}
      </button>
      {phase === 'ready' && <p className="hint">A short, quiet tone. It plays over the music.</p>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {phase === 'asking' && (
        <div className="row wrap" role="group" aria-label="Did you hear the tone?">
          <span>Did you hear it?</span>
          <button ref={yes} type="button" onClick={heard}><Icon name="check" size="toolbar" /> Yes</button>
          <button type="button" onClick={heardNothing}>No</button>
        </div>
      )}
      {phase === 'heard_nothing' && (
        <div className="sound-check-help" role="status">
          <p><b>Let’s find the sound.</b> Check these, then play the tone again:</p>
          <ul>{[...ROUTE_CHECKS.any, ...ROUTE_CHECKS.system].map((check) => <li key={check}>{check}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
