import { useEffect, useState } from 'react';

export type SkeletonVariant = 'text' | 'cards' | 'vibes' | 'library' | 'listen' | 'timeline' | 'inspector' | 'pairs' | 'metrics';

/** Reserve real content geometry immediately, fading decorative placeholders in only if needed. */
export function Skeleton({ lines = 3, label = 'Loading', variant = 'text', retry }: {
  lines?: number;
  label?: string;
  variant?: SkeletonVariant;
  retry?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
    <div className={`skeleton skeleton-${variant}`} role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-content" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
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
