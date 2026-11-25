import { useEffect, useRef, useState } from 'react';
import { whenWords } from '../cloud/lucyUsage';
import type { LimitNotice } from '../lucy/types';
import { LinkIfThere } from '../shell/PageLink';

/** The one next step under Lucy's words when a limit was reached (ADR-0483 rule 6): only the
 * choices the server says apply. Waiting is plain words with the time; plans is a link to Plan &
 * billing; extra usage is a button. It is shown once per limit event and never while the reply is
 * still arriving (the transcript decides both), and it never touches what is typed in the box. */

/** Causes that are not the person's own allowance: nothing was used, and there is no reset to name. */
const NOT_THEIRS = new Set<LimitNotice['cause']>(['platform', 'backstop', 'no_model']);

export function waitWords(limit: LimitNotice): string {
  const when = whenWords(limit.back_words);
  if (limit.cause === 'session_lighter') return when ? `Lucy is back to normal ${when}.` : 'Lucy is back to normal when this session ends.';
  if (when) return `Lucy is back ${when}.`;
  if (NOT_THEIRS.has(limit.cause)) return 'Try again in a little while.';
  return limit.cause === 'week' ? 'Lucy is back when this week’s use starts again.' : 'Lucy is back when this session ends.';
}

/** What the press came to: 'none' when the balance had gone by then. Nothing given counts as on. */
export type ExtraOutcome = 'on' | 'none' | void;

/** "Use extra usage" (ADR-0486 rule 3): one press says yes for this week. It cannot be pressed twice
 * while the yes is on its way (it stays focusable, so the keyboard keeps its place), a failure is said plainly and leaves the button to press again, and
 * once it lands the button gives way to what to do next. */
function ExtraStep({ onExtra }: { onExtra: () => ExtraOutcome | Promise<ExtraOutcome> }) {
  const [state, setState] = useState<'idle' | 'pending' | 'on' | 'none' | 'failed'>('idle');
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const press = async () => {
    if (busy.current) return;
    busy.current = true;
    setState('pending');
    let next: 'on' | 'none' | 'failed';
    try {
      next = (await onExtra()) === 'none' ? 'none' : 'on';
    } catch {
      next = 'failed';
    }
    busy.current = false;
    if (live.current) setState(next);
  };
  if (state === 'on') return <li role="status">Extra usage is on for this week. Send your message again.</li>;
  if (state === 'none') return <li role="status">There’s no extra usage left to use.</li>;
  return (
    <li>
      <button type="button" onClick={() => void press()} aria-disabled={state === 'pending' || undefined} aria-busy={state === 'pending' || undefined}>Use extra usage</button>
      {state === 'failed' && <span role="alert" className="lucy-limit-problem"> Couldn’t turn on extra usage. Try again.</span>}
    </li>
  );
}

export function LucyLimitStep({ limit, onExtra }: {
  limit: LimitNotice;
  /** Use extra usage. Without it the choice is not offered: a button that did nothing would be a lie. */
  onExtra?: () => ExtraOutcome | Promise<ExtraOutcome>;
}) {
  const wait = limit.next.includes('wait');
  const plans = limit.next.includes('plans');
  const extra = limit.next.includes('extra') && !!onExtra;
  if (!wait && !plans && !extra) return null;
  return (
    <aside className="lucy-limit-step" aria-label="What you can do next" data-cause={limit.cause}>
      <p className="lucy-limit-title">What you can do next</p>
      <ul>
        {wait && <li>{waitWords(limit)}</li>}
        {plans && <li><LinkIfThere to="/account/billing">See plans</LinkIfThere></li>}
        {extra && onExtra && <ExtraStep onExtra={onExtra} />}
      </ul>
    </aside>
  );
}
