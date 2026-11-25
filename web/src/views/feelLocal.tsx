import { RefObject, useLayoutEffect, useRef, useState } from 'react';
import { BlendArt } from '../cloud/BlendArt';
import { feelCalm, feelOn } from '../feel/root';
import { Moment, type MomentKind } from '../feel/moment';
import { useFeelOn } from './feelPieces';

/** Feel pieces for the local app's own screens (ADR-0477, plan 3.15): the first scan, export, the
 * Workspace jobs and the not-found page. Each one draws nothing, or exactly what was there before,
 * while the feel is off. Styles: styles/feel-local.css. */

/** A plain count, written the way these pages always wrote it. */
export const plainCount = (value: number) => String(value);

/** Glow a row once (.feel-flash) when `done` turns from false to true while it is on screen, such as
 * a job finishing. Null means not known yet (the answer has not come), so the first real answer
 * never glows; neither does anything while motion is off or calm. */
export function useFlashOn(ref: RefObject<HTMLElement | null>, done: boolean | null) {
  const last = useRef(done);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = done;
    if (before !== false || done !== true) return;
    const element = ref.current;
    if (!element || !feelOn('motion') || feelCalm()) return;
    element.classList.remove('feel-flash');
    // read layout once so the class added again starts its animation afresh
    void element.offsetWidth;
    element.classList.add('feel-flash');
    element.addEventListener('animationend', () => element.classList.remove('feel-flash'), { once: true });
  }, [done]);
}

/** Glow a row once when it first appears, for a row that is new since the list was last drawn. */
export function useFlashOnArrival(ref: RefObject<HTMLElement | null>, fresh: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!fresh || !element || !feelOn('motion') || feelCalm()) return;
    element.classList.add('feel-flash');
    element.addEventListener('animationend', () => element.classList.remove('feel-flash'), { once: true });
  }, []);
}

/** True once, from the moment `reached` turns true while this is on screen until the celebration
 * has played. A page opened already there never celebrates: only a real change seen here does. */
export function useReachedMoment(reached: boolean): [boolean, () => void] {
  const was = useRef(reached);
  const [now, setNow] = useState(false);
  useLayoutEffect(() => {
    if (reached && !was.current && feelOn('moments')) setNow(true);
    was.current = reached;
  }, [reached]);
  return [now, () => setNow(false)];
}

/** The one celebration, in a layer laid over the box that holds it (feel-local.css positions the
 * holder only while the layer is there). */
export function MomentLayer({ kind, onDone }: { kind: MomentKind; onDone: () => void }) {
  return <span className="feel-local-moment" aria-hidden="true"><Moment kind={kind} onDone={onDone} /></span>;
}

/** The blend drawing's "missing" variant on the local not-found page, as on Cloud's. It is
 * decoration, and only drawn while the feel is on, so the page is as it was with the flags off. */
export function MissingArt() {
  const feel = useFeelOn();
  if (!feel) return null;
  return <div className="feel-local-missing"><BlendArt variant="missing" /></div>;
}
