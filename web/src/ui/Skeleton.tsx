import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from './exitMotion';

/** P0035: Edit's timeline is song rows with a transition hanging between each pair, so its
 * placeholder is the same: a song row (grip, title, artist, facts), then a transition (name, region,
 * action), alternating, so the loaded timeline lands where the placeholder was. */
function timelineUnits(songs: number) {
  return Array.from({ length: Math.max(1, songs) * 2 - 1 }, (_, index) => index % 2 === 0 ? (
    <div className="skeleton-unit skeleton-song" key={index}>
      <i className="skeleton-grip" />
      <i className="skeleton-title" />
      <i className="skeleton-detail" />
      <i className="skeleton-meta" />
    </div>
  ) : (
    <div className="skeleton-unit skeleton-seam" key={index}>
      <i className="skeleton-title" />
      <i className="skeleton-region" />
      <i className="skeleton-action" />
    </div>
  ));
}

/** P0032: a Mix feeling card is its motif, name, summary, facts, the "Why" disclosure and the actions
 * row closing the card (Play and Shape first side by side, Save draft under them), so its placeholder is
 * the same pieces in the same order, with the actions pinned to the card's foot as the real ones are. */
function vibeUnits(cards: number) {
  return Array.from({ length: cards }, (_, index) => (
    <div className="skeleton-unit skeleton-vibe" key={index}>
      <i className="skeleton-motif" />
      <i className="skeleton-title" />
      <i className="skeleton-detail" />
      <i className="skeleton-meta" />
      <i className="skeleton-disclosure" />
      <span className="skeleton-actions"><i className="skeleton-action" /><i className="skeleton-action" /><i className="skeleton-action-quiet" /></span>
    </div>
  ));
}

/** P0034: Listen's words. The song's title and artist are already real above, and the waveform has its
 * own flat placeholder (Now.tsx), so this is only the lyric sheet's shape: the timing note, then the
 * line before, the line being sung (larger) and the line after. No bar here stands for audio. */
function lyricUnits() {
  return (
    <div className="skeleton-unit skeleton-lyrics">
      <i className="skeleton-meta" />
      <i className="skeleton-detail" />
      <i className="skeleton-title" />
      <i className="skeleton-detail" />
    </div>
  );
}

/** P0036: list-shaped information (Workshop's "What's happening now" and diagnostics) is rows of a
 * label and a status, not tiles, so its placeholder is rows at the list's own tracks. */
function rowUnits(rows: number) {
  return Array.from({ length: Math.max(1, rows) }, (_, index) => (
    <div className="skeleton-unit skeleton-row" key={index}>
      <i className="skeleton-title" />
      <i className="skeleton-detail" />
    </div>
  ));
}

export type SkeletonVariant ='text' | 'cards' | 'vibes' | 'library' | 'listen' | 'timeline' | 'inspector' | 'pairs' | 'metrics' | 'rows';

/** P0038: an answer that arrives within this long never shows a placeholder at all. The space is
 * reserved from the first frame (so nothing moves), but the bars stay invisible until then, in every
 * motion setting: with reduced motion the fade is gone, the wait is not, because a wait isn't motion.
 * Matches --motion-fast; ready content is never held back to honour it. */
export const REVEAL_AFTER_MS = 120;

/** P0038's wait, for a placeholder drawn outside Skeleton (Listen's waveform region): false until
 * REVEAL_AFTER_MS has passed since it mounted. */
export function useRevealed() {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), REVEAL_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return revealed;
}

/** How many of the arriving pieces rise one after another; the rest come with the last of them. */
const ARRIVAL_STAGGER_LIMIT = 8;

/** ADR-0477 (plan 3.0 "Skeletons"): when a placeholder that was really shown gives way to the
 * content, that content fades in with a short rise, piece after piece, instead of swapping in hard.
 * The placeholder remembers its neighbours at every commit; once it has gone, whatever now stands
 * between them is what replaced it. Only with the feel's motion on and nothing asking for calm,
 * and never for an answer quick enough that no placeholder was shown (it would only delay it).
 * Script animations, opacity and translate only, cancelled by nothing because they are short. */
function useArrivalAfter(revealed: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const around = useRef<{ parent: Element | null; before: Element | null; after: Element | null; shown: boolean }>({ parent: null, before: null, after: null, shown: false });
  useLayoutEffect(() => {
    const node = box.current;
    around.current = { parent: node?.parentElement ?? null, before: node?.previousElementSibling ?? null, after: node?.nextElementSibling ?? null, shown: revealed };
  });
  useLayoutEffect(() => () => {
    const { parent, before, after, shown } = around.current;
    const own = box.current;
    if (!shown || !parent || !feelOn('motion') || feelCalm()) return;
    queueMicrotask(() => {
      if (!parent.isConnected || typeof Element.prototype.animate !== 'function') return;
      const arrived: Element[] = [];
      let at = before?.parentElement === parent ? before.nextElementSibling : parent.firstElementChild;
      while (at && at !== after && arrived.length < 40) {
        if (at !== own) arrived.push(at);
        at = at.nextElementSibling;
      }
      const duration = motionMs('--motion-reveal', 160);
      const gap = motionMs('--motion-stagger', 30);
      if (!duration) return;
      arrived.forEach((piece, index) => {
        piece.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], {
          duration,
          delay: Math.min(index, ARRIVAL_STAGGER_LIMIT) * gap,
          easing: 'ease-out',
          fill: 'backwards',
        });
      });
    });
  }, []);
  return box;
}

/** Reserve real content geometry immediately, fading decorative placeholders in only if needed. */
export function Skeleton({ lines = 3, label = 'Loading', variant = 'text', retry }: {
  lines?: number;
  label?: string;
  variant?: SkeletonVariant;
  retry?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const revealed = useRevealed();
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [attempt]);
  const tryAgain = () => {
    setSlow(false);
    setAttempt((value) => value + 1);
    retry?.();
  };
  const count = variant === 'inspector' ? 1 : lines;
  const box = useArrivalAfter(revealed);
  return (
    <div ref={box} className={`skeleton skeleton-${variant}`} role="status" aria-live="polite" aria-busy="true" aria-label={label} data-revealed={revealed}>
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-content" aria-hidden="true">
        {variant === 'timeline' ? timelineUnits(lines) : variant === 'vibes' ? vibeUnits(lines) : variant === 'listen' ? lyricUnits() : variant === 'rows' ? rowUnits(lines) : Array.from({ length: count }, (_, index) => (
          <div className="skeleton-unit" key={index}>
            <i className="skeleton-title" />
            {variant !== 'text' && <><i className="skeleton-detail" /><i className="skeleton-meta" /></>}
            {['timeline', 'inspector', 'pairs'].includes(variant) && <i className="skeleton-region" />}
            {['cards', 'vibes', 'pairs', 'inspector'].includes(variant) && <i className="skeleton-action" />}
          </div>
        ))}
      </div>
      {slow && (
        <div className="row wrap skeleton-slow">
          <p className="hint">This is taking longer than expected. You can keep waiting{retry ? ' or try again' : ''}.</p>
          {retry && <button type="button" onClick={tryAgain}>Try again</button>}
        </div>
      )}
    </div>
  );
}
