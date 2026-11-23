import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import './cloudMusic.css';
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
    <section className="sound-check banner" data-tone="warn" data-phase={phase} aria-label="Sound check">
      <Icon name="volume" />
      <p className="banner-text">
        <b>Sound not confirmed.</b>{' '}
        <span>{phase === 'asking' ? 'Did you hear the tone?' : phase === 'playing' ? 'A short, quiet tone is playing over the music.' : phase === 'heard_nothing' ? 'Check the list below, then try again.' : 'Play a short tone to check this device.'}</span>
      </p>
      <div className="banner-actions">
        {phase === 'asking' && (
          <span className="row" role="group" aria-label="Did you hear the tone?">
            <button ref={yes} type="button" className="small primary" onClick={heard}><Icon name="check" size="toolbar" /> Yes</button>
            <button type="button" className="small" onClick={heardNothing}>No</button>
          </span>
        )}
        <button ref={playButton} type="button" className={again ? 'small quiet' : 'small'} onClick={play} aria-busy={phase === 'playing' || undefined} aria-disabled={phase === 'playing' || undefined}>
          {phase === 'playing' ? 'Playing tone…' : again ? 'Play it again' : 'Check sound'}
        </button>
      </div>
      {problem && <p className="warn sound-check-more" role="alert">{problem}</p>}
      {phase === 'heard_nothing' && (
        <div className="sound-check-help sound-check-more" role="status">
          <ul>{[...ROUTE_CHECKS.any, ...ROUTE_CHECKS.system].map((check) => <li key={check}>{check}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
