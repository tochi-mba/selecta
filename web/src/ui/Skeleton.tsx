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
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-live="polite" aria-busy="true" aria-label={label} data-revealed={revealed}>
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
