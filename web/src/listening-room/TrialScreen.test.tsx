import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { answerOf, chooseVerdict, createSession, recordFailure, setNote, toggleReason, type Label, type Session } from './session';
import { TrialScreen, type Listening } from './TrialScreen';

/** The trial screen's keyboard flow, with the sound mocked: the page's audition layer is replaced by
 * a fake that only records what was asked of it. */

const session = (): Session => createSession({
  workspaceId: 'w', mixId: null, mixName: 'Test mix', seed: 3, now: 1,
  mix: [1, 2, 3].map((id) => ({ song_id: id, title: `Title ${id}`, artist: `Artist ${id}`, duration: 180 })),
  playable: () => true,
})!;

function Harness({ start, audition, onNext, onBack, blocked = false }: {
  start: Session;
  audition: { play: (label: Label) => void; toggle: () => void };
  onNext: () => void;
  onBack: () => void;
  blocked?: boolean;
}) {
  const [kept, setKept] = useState(start);
  const [listening, setListening] = useState<Listening>({ label: null, progress: null, preparing: false, last: null });
  const trial = kept.trials[kept.position];
  return (
    <TrialScreen
      trial={trial}
      answer={answerOf(kept, trial.id)}
      number={kept.position + 1}
      count={kept.trials.length}
      listening={listening}
      blocked={blocked}
      onPlay={(label) => { audition.play(label); setListening((now) => ({ ...now, label, last: label, progress: { phase: 'playing', label, elapsed: 3, total: 40, mark: 15, markKnown: true } })); }}
      onToggle={audition.toggle}
      onReplay={() => audition.play(listening.last ?? 'A')}
      onVerdict={(verdict) => setKept((now) => chooseVerdict(now, trial.id, verdict))}
      onReason={(reason) => setKept((now) => toggleReason(now, trial.id, reason))}
      onNote={(note) => setKept((now) => setNote(now, trial.id, note))}
      onBack={onBack}
      onSkip={onNext}
      onNext={onNext}
      onStop={() => undefined}
    />
  );
}

const key = (name: string, target: Element = document.body) => act(() => { fireEvent.keyDown(target, { key: name }); });

describe('the trial screen by keyboard', () => {
  it('plays, switches and pauses with Space, 1, 2, A and B, and shows where the transition is', () => {
    const audition = { play: vi.fn(), toggle: vi.fn() };
    render(<Harness start={session()} audition={audition} onNext={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Title 1.*into.*Title 2/ })).toHaveFocus();
    key('1');
    expect(audition.play).toHaveBeenLastCalledWith('A');
    // the version already playing is not started again by its own key
    key('a');
    expect(audition.play).toHaveBeenCalledTimes(1);
    key('2');
    expect(audition.play).toHaveBeenLastCalledWith('B');
    key('A');
    expect(audition.play).toHaveBeenLastCalledWith('A');
    key(' ');
    expect(audition.toggle).toHaveBeenCalledTimes(1);
    const playing = screen.getByRole('button', { name: /Version A/ });
    expect(playing).toHaveAttribute('aria-pressed', 'true');
    expect(playing).toHaveTextContent('0:03 of 0:40, transition at 0:15');
    expect(playing.querySelector<HTMLElement>('.lr-track-mark')!.style.insetInlineStart).toBe('37.5%');
  });

  it('answers with a letter, goes on with Enter or the right arrow only once there is a verdict, and back with the left arrow', () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(<Harness start={{ ...session(), position: 1 }} audition={{ play: vi.fn(), toggle: vi.fn() }} onNext={onNext} onBack={onBack} />);
    key('Enter');
    key('ArrowRight');
    expect(onNext).not.toHaveBeenCalled();
    key('w');
    expect(screen.getByRole('button', { name: /B is better/ })).toHaveAttribute('aria-pressed', 'true');
    key('e');
    expect(screen.getByRole('button', { name: /No difference/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /B is better/ })).toHaveAttribute('aria-pressed', 'false');
    key('ArrowRight');
    key('Enter');
    expect(onNext).toHaveBeenCalledTimes(2);
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone while a note is typed, and leaves Space to a focused button', () => {
    const audition = { play: vi.fn(), toggle: vi.fn() };
    render(<Harness start={session()} audition={audition} onNext={vi.fn()} onBack={vi.fn()} />);
    const note = screen.getByRole('textbox', { name: /Note/ });
    key('1', note);
    key('q', note);
    key(' ', note);
    expect(audition.play).not.toHaveBeenCalled();
    expect(audition.toggle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /A is better/ })).toHaveAttribute('aria-pressed', 'false');
    key(' ', screen.getByRole('button', { name: /Version B/ }));
    expect(audition.toggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Space/, { selector: 'kbd' })).toBeInTheDocument();
  });

  it('offers only Can’t judge for a transition that could not be played, and plays nothing', () => {
    const audition = { play: vi.fn(), toggle: vi.fn() };
    const failed = recordFailure(session(), session().trials[0].id, 'a song is not on this device');
    render(<Harness start={failed} audition={audition} onNext={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /A is better/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Version A/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('could not be played here: a song is not on this device');
    key('1');
    key('q');
    expect(audition.play).not.toHaveBeenCalled();
    key('t');
    expect(screen.getByRole('button', { name: /Can’t judge/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('plays nothing while the mix is playing on this device', () => {
    const audition = { play: vi.fn(), toggle: vi.fn() };
    render(<Harness start={session()} audition={audition} onNext={vi.fn()} onBack={vi.fn()} blocked />);
    key('1');
    key(' ');
    expect(audition.play).not.toHaveBeenCalled();
    expect(audition.toggle).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Pause your mix to listen here.');
  });
});
