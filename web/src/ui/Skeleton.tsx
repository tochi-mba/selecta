import { useEffect, useState } from 'react';

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

export type SkeletonVariant ='text' | 'cards' | 'vibes' | 'library' | 'listen' | 'timeline' | 'inspector' | 'pairs' | 'metrics';

/** P0038: an answer that arrives within this long never shows a placeholder at all. The space is
 * reserved from the first frame (so nothing moves), but the bars stay invisible until then, in every
 * motion setting: with reduced motion the fade is gone, the wait is not, because a wait isn't motion.
 * Matches --motion-fast; ready content is never held back to honour it. */
export const REVEAL_AFTER_MS = 120;

/** Reserve real content geometry immediately, fading decorative placeholders in only if needed. */
export function Skeleton({ lines = 3, label = 'Loading', variant = 'text', retry }: {
  lines?: number;
  label?: string;
  variant?: SkeletonVariant;
  retry?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), REVEAL_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [attempt]);
  const tryAgain = () => {
    setSlow(false);
    setAttempt((value) => value + 1);
    retry?.();
  };
  const count = variant === 'listen' || variant === 'inspector' ? 1 : lines;
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-live="polite" aria-busy="true" aria-label={label} data-revealed={revealed}>
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-content" aria-hidden="true">
        {variant === 'timeline' ? timelineUnits(lines) : Array.from({ length: count }, (_, index) => (
          <div className="skeleton-unit" key={index}>
            <i className="skeleton-title" />
            {variant !== 'text' && <><i className="skeleton-detail" /><i className="skeleton-meta" /></>}
            {['listen', 'timeline', 'inspector', 'pairs'].includes(variant) && <i className="skeleton-region" />}
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
