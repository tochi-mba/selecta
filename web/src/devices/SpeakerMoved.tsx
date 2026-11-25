import { useEffect, useRef, useState } from 'react';
import { success } from '../feel/haptics';
import { useFeelPart } from '../rooms/feelHooks';

// ADR-0477: when the sound really moves to another speaker, one pulse travels from the old
// speaker's chip to the new one's, then the new one shows a tick and a phone that can buzzes once.
//
// "Really" means the playback session itself now names a different speaker than the last read
// did; a press that asked for the move is not enough, so nothing here runs ahead of the music. The
// buzz is an echo of the person's own press, so a move that lands long after the press (or one
// started from another device) does not buzz: feel/haptics only buzzes inside a press.

/** How long the move stays said on the remote before the line goes back to the speaker alone. */
export const MOVED_MS = 3200;

export type SpeakerMove = { from: string; to: string; at: number };

/** The last real change of speaker, for MOVED_MS; null otherwise. The first read only learns
 * where the music is, and a speaker going away (no speaker) is not a move. */
export function useSpeakerMove(id: string | null | undefined, name: string | null | undefined): SpeakerMove | null {
  const last = useRef<{ id: string; name: string } | null>(null);
  const [moved, setMoved] = useState<SpeakerMove | null>(null);
  useEffect(() => {
    if (!id) return;
    const before = last.current;
    last.current = { id, name: name ?? 'another device' };
    if (!before || before.id === id) return;
    setMoved({ from: before.name, to: name ?? 'another device', at: Date.now() });
    success();
  }, [id, name]);
  useEffect(() => {
    if (!moved) return undefined;
    const timer = window.setTimeout(() => setMoved(null), MOVED_MS);
    return () => window.clearTimeout(timer);
  }, [moved]);
  return moved;
}

/** The two speakers' chips with the pulse between them. Shown only with motion on: the line above
 * it already names where the music plays, so nothing is lost without it. */
export function SpeakerMoved({ move }: { move: SpeakerMove | null }) {
  const moving = useFeelPart('motion');
  if (!move || !moving) return null;
  return (
    // keyed by the move, so a second move plays its pulse again
    <p key={move.at} className="speaker-moved" role="status" data-testid="speaker-moved">
      <span className="visually-hidden">The music moved from {move.from} to {move.to}.</span>
      <span className="speaker-chip" dir="auto" aria-hidden="true">{move.from}</span>
      <span className="speaker-moved-track" aria-hidden="true"><span className="speaker-moved-pulse"><i /></span></span>
      <span className="speaker-chip speaker-chip-new" dir="auto" aria-hidden="true">
        {move.to}
        <svg className="speaker-picker-tick" viewBox="0 0 24 24"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
    </p>
  );
}
