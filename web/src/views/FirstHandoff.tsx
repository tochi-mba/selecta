import { useEffect, useRef, useState } from 'react';
import type { MixItem } from '../api';
import { lastHandoffHeard, onHandoffHeard, type HandoffHeard } from '../audio/handoffHeard';
import { flagOn } from '../flags';
import type { NowState } from '../player';
import { Moment } from '../feel/moment';
import { feelOn } from '../feel/root';
import { SeamDiagram } from '../ui/MusicObjects';
import { useFeelPart } from './feelBits';

/** CI-0178-05: the first earned reward. It waits for the players' "hand-over heard" signal
 * (audio/handoffHeard.ts, T-20261125-ebda), which is said only once a hand-over has really played to
 * its end in this tab while it was on screen, in local mode and in Cloud alike. So a plan, a
 * transition still rendering, a Pause before the hand-off or a hand-over in a hidden tab can never
 * trigger this. The note names the two songs it joined, never blocks anything, never starts or stops
 * sound, and once it has been seen and dismissed it stays gone. */

export const FIRST_HANDOFF_KEY = 'selecta.firstHandoffSeen';

function seenBefore(): boolean {
  try {
    return window.localStorage.getItem(FIRST_HANDOFF_KEY) === '1';
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(FIRST_HANDOFF_KEY, '1');
  } catch {
    // storage can be denied; the note then simply closes for this visit
  }
}

type Joined = { from: string; into: string; seam?: MixItem['seam'] };

/** The two songs of this mix a heard hand-over joined, or null when it is not one of this mix's. */
export function joinedIn(mix: readonly MixItem[], heard: HandoffHeard): Joined | null {
  const from = mix[heard.fromIndex];
  const into = mix[heard.intoIndex];
  if (!from || !into || heard.intoIndex !== heard.fromIndex + 1) return null;
  // the mix may have changed under it: the songs and the rendered seam must still be the ones heard
  if (heard.fromSongId !== undefined && from.song_id !== heard.fromSongId) return null;
  if (heard.intoSongId !== undefined && into.song_id !== heard.intoSongId) return null;
  if (heard.seamKey && into.seam?.state?.key !== heard.seamKey) return null;
  // the drawing shows only a finished, rendered transition; a hand-over worked out live has its words
  const seam = into.seam?.state?.status === 'ready' ? into.seam : undefined;
  return { from: from.title, into: into.title, seam };
}

export function FirstHandoff({ mix }: { now?: NowState; mix: MixItem[] }) {
  const [heard, setHeard] = useState<Joined | null>(null);
  const [gone, setGone] = useState(seenBefore);
  const on = flagOn('listen.first_handoff');
  // ADR-0477: under the moments part, the note arrives with the seam it joined drawn beside it and a
  // one-off celebration; the words are the same either way and say everything the drawing shows
  const moments = useFeelPart('moments');
  const [celebrating, setCelebrating] = useState(false);
  const mixNow = useRef(mix);
  mixNow.current = mix;

  useEffect(() => {
    if (!on || gone || heard) return;
    const take = (signal: HandoffHeard | null) => {
      const joined = signal ? joinedIn(mixNow.current, signal) : null;
      if (!joined) return false;
      setHeard(joined);
      setCelebrating(feelOn('moments'));
      // seeing it once is enough: it won't come back on the next visit even if it isn't dismissed
      remember();
      return true;
    };
    // one heard earlier in this visit, while Listen was not open, still counts
    if (take(lastHandoffHeard())) return;
    return onHandoffHeard((signal) => { take(signal); });
  }, [on, gone, heard]);

  if (!on || gone || !heard) return null;
  return (
    <aside className="notice first-handoff" role="status" aria-label="Your first hand-off" data-first-handoff="" data-arrive={moments ? '' : undefined}>
      {moments && heard.seam && (
        <div className="first-handoff-seam" aria-hidden="true">
          <SeamDiagram seam={heard.seam} from={heard.from} into={heard.into} compact />
        </div>
      )}
      {celebrating && <Moment kind="blend" onDone={() => setCelebrating(false)} />}
      <p>
        That was your first SelectaDJ hand-off: <span dir="auto">{heard.from}</span> into <span dir="auto">{heard.into}</span>, joined
        as one finished transition instead of a gap.
      </p>
      <button type="button" className="quiet" onClick={() => setGone(true)}>Got it</button>
    </aside>
  );
}
