import { useEffect, useState } from 'react';
import type { MixItem } from '../api';
import { flagOn } from '../flags';
import type { NowState } from '../player';

/** CI-0178-05: the first earned reward. The player sets `lastSeamKey` only once a finished, rendered
 * transition has actually played through its switch point, so a plan, a transition still rendering, or
 * a Pause before the hand-off can never trigger this. The note names the two songs it joined, never
 * blocks anything, never starts or stops sound, and once it has been seen and dismissed it stays gone. */

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

export function FirstHandoff({ now, mix }: { now: NowState; mix: MixItem[] }) {
  const [heard, setHeard] = useState<{ from: string; into: string } | null>(null);
  const [gone, setGone] = useState(seenBefore);
  const on = flagOn('listen.first_handoff');

  useEffect(() => {
    if (!on || gone || heard || !now.lastSeamKey || now.phase !== 'playing') return;
    const at = mix.findIndex((item) => item.seam?.state?.key === now.lastSeamKey);
    // only a transition this mix really has, between two songs it really holds
    if (at < 1 || mix[at].seam?.state?.status !== 'ready') return;
    setHeard({ from: mix[at - 1].title, into: mix[at].title });
    // seeing it once is enough: it won't come back on the next visit even if it isn't dismissed
    remember();
  }, [on, gone, heard, now.lastSeamKey, now.phase, mix]);

  if (!on || gone || !heard) return null;
  return (
    <aside className="notice first-handoff" role="status" aria-label="Your first hand-off" data-first-handoff="">
      <p>
        That was your first SelectaDJ hand-off: <span dir="auto">{heard.from}</span> into <span dir="auto">{heard.into}</span>, joined
        as one finished transition instead of a gap.
      </p>
      <button type="button" className="quiet" onClick={() => setGone(true)}>Got it</button>
    </aside>
  );
}
