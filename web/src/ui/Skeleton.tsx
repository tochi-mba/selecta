import { useEffect, useState } from 'react';

export type SkeletonVariant = 'text' | 'cards' | 'library' | 'listen' | 'timeline' | 'inspector' | 'pairs' | 'metrics';

/** Reserve real content geometry immediately, fading decorative placeholders in only if needed. */
export function Skeleton({ lines = 3, label = 'Loading', variant = 'text' }: { lines?: number; label?: string; variant?: SkeletonVariant }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, []);
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
            {['cards', 'pairs', 'inspector'].includes(variant) && <i className="skeleton-action" />}
          </div>
        ))}
      </div>
      {slow && <p className="hint">Still waiting for Selecta. If the server has stopped, start it again.</p>}
    </div>
  );
}
