// Listen's seek strip: the song's waveform with sections and the seam, the playhead and the
// drag-to-seek preview, plus its placeholder. Split out of Now.tsx (file length limit).
import { KeyboardEvent, PointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SongDetail } from '../api';
import { clock } from '../lib';
import { transportClock } from '../audio/transportWords';
import { announce, Tooltip } from '../ui/controls';
import { useRevealed } from '../ui/Skeleton';

const SECTION_WORDS: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  break: 'Break',
  outro: 'Outro',
  instrumental: 'Band',
};

function mergedSections(detail: SongDetail) {
  const merged: { label: string; start: number; end: number }[] = [];
  for (const section of detail.sections) {
    const last = merged[merged.length - 1];
    if (last && last.label === section.label) last.end = section.end;
    else merged.push({ ...section });
  }
  return merged;
}

const CANT_SEEK = 'You can’t move around during a transition, because it plays as one finished piece. You can again once the next song has taken over.';

/** The whole song as one strip, with its sections named. Where the seam falls is marked. During a
 * transition it stays the same control, and says why it won't move rather than quietly becoming
 * something else. */
/** P0034: while this song's details load, the waveform's place is held at the strip's own height and
 * margins by one flat, even block: no peaks, no shape, nothing that could be read as this song's audio.
 * It appears only after the same short wait as every placeholder (P0038), and says nothing to a screen
 * reader; the lyric placeholder below carries the one "Loading this song" announcement. */
export function StripPlaceholder() {
  const revealed = useRevealed();
  // the empty note under the real strip keeps its line too, so nothing below moves when the song arrives
  return <><div className="skeleton-strip" aria-hidden="true" data-revealed={revealed} /><p className="hint seek-note" aria-hidden="true">{' '}</p></>;
}

export function Strip({ detail, time, seamAt, onSeek, seekBlocked }: { detail: SongDetail; time: number; seamAt: number | null; onSeek: (seconds: number) => void; seekBlocked?: boolean }) {
  const noteId = useId();
  const duration = Number.isFinite(detail.duration) && detail.duration > 0 ? detail.duration : 0;
  const safeTime = Math.min(Math.max(Number.isFinite(time) ? time : 0, 0), duration);
  const unavailable = duration === 0;
  const locked = !!seekBlocked || unavailable;
  const unavailableWords = 'The duration of this song is not known yet, so seeking is unavailable.';
  // A pointer drag is a proposal, not an actual seek. Keep the real playhead
  // anchored to the audio clock until the pointer is released and the player accepts it.
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  // While the slider has focus, its spoken value holds still and moves only when the listener seeks:
  // a value that ticks with the music makes a screen reader read the clock aloud twice a second.
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const spokenTime = heldAt === null ? safeTime : Math.min(heldAt, duration);
  useEffect(() => {
    dragging.current = null;
    setSeekPreview(null);
  }, [detail.id, seekBlocked]);
  // A new song starts from its beginning, even for a slider that kept focus across the change.
  useEffect(() => setHeldAt((held) => (held === null ? null : 0)), [detail.id]);
  const percent = (seconds: number) =>
    100 * Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), duration) / Math.max(duration, 1);
  const shape = useMemo(() => {
    const step = 100 / Math.max(detail.peaks.length, 1);
    return detail.peaks
      .map((peak, index) => {
        const height = Math.max(peak * 100, 4);
        return `M${(index * step).toFixed(2)} ${(50 - height / 2).toFixed(1)}v${height.toFixed(1)}`;
      })
      .join('');
  }, [detail.peaks]);
  const sections = useMemo(() => mergedSections(detail), [detail]);
  const barTimes = detail.bar_times ?? [];
  const clip = `played-${detail.id}`;
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || unavailable) return null;
    return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * duration;
  };
  const beginSeek = (event: PointerEvent<HTMLDivElement>) => {
    // Real browsers expose isPrimary; tolerate older PointerEvent shims that omit it.
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    if (locked) {
      announce(unavailable ? unavailableWords : CANT_SEEK);
      return;
    }
    const target = pointAt(event);
    if (target === null) return;
    dragging.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSeekPreview(target);
  };
  const moveSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== event.pointerId) return;
    const target = pointAt(event);
    if (target !== null) setSeekPreview(target);
  };
  const endSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    const target = pointAt(event);
    setSeekPreview(null);
    if (!locked && target !== null) onSeek(target);
  };
  const cancelSeek = () => {
    dragging.current = null;
    setSeekPreview(null);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: safeTime - 5, ArrowDown: safeTime - 5, ArrowRight: safeTime + 5, ArrowUp: safeTime + 5, Home: 0, End: Math.max(duration - 1, 0), PageDown: safeTime - 30, PageUp: safeTime + 30 };
    if (moves[event.key] === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (locked) announce(unavailable ? unavailableWords : CANT_SEEK);
    else {
      const target = Math.min(Math.max(moves[event.key], 0), duration);
      setHeldAt(target);
      onSeek(target);
    }
  };
  return (
    <>
    <div
      className={`strip ${locked ? 'seek-blocked' : 'can-seek'}`}
      role="slider"
      tabIndex={0}
      aria-label="Where in the song"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(spokenTime)}
      aria-valuetext={unavailable ? 'Duration unknown' : `${transportClock(spokenTime)} of ${transportClock(duration)}, ${transportClock(duration - spokenTime)} left`}
      aria-disabled={locked || undefined}
      aria-describedby={locked ? noteId : undefined}
      onPointerDown={beginSeek}
      onPointerMove={moveSeek}
      onPointerUp={endSeek}
      onPointerCancel={cancelSeek}
      onLostPointerCapture={cancelSeek}
      onKeyDown={keys}
      onFocus={() => setHeldAt(safeTime)}
      onBlur={() => setHeldAt(null)}
    >
      <svg className="peaks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width={percent(time)} height="100" />
          </clipPath>
        </defs>
        <path d={shape} className="unplayed" vectorEffect="non-scaling-stroke" />
        <path d={shape} className="played" clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bar-ticks" aria-hidden="true">
        {barTimes
          .filter((_, index) => index % Math.max(1, Math.ceil(barTimes.length / 24)) === 0)
          .map((bar, index) => (
            <i key={index} style={{ left: `${percent(bar)}%` }} />
          ))}
      </div>
      <div className="sections">
        {sections.map((section, index) => {
          const width = percent(section.end - section.start);
          return (
            <span key={index} style={{ left: `${percent(section.start)}%`, width: `${width}%` }}>
              {width > 9 ? (SECTION_WORDS[section.label] ?? section.label) : ''}
            </span>
          );
        })}
      </div>
      {seamAt !== null && <b className="seam-mark" style={{ left: `${percent(seamAt)}%` }} title={`Seam at ${clock(seamAt)}`} />}
      <b className="playhead" style={{ left: `${percent(time)}%` }} aria-hidden="true" />
      {seekPreview !== null && (
        <b className="scrub-ghost" style={{ left: `${percent(seekPreview)}%` }} aria-hidden="true" />
      )}
      {/* MP-0274-03: room for the longest reading this song can show, "duration / duration", so the clock
          never widens and nudges the separator when 9:59 becomes 10:00 */}
      <span className="time" style={{ minWidth: `${(unavailable ? 0 : clock(duration).length * 2) + 3}ch` }}>
        {seekPreview === null ? transportClock(safeTime) : `Seek to ${transportClock(seekPreview)}`} / {unavailable ? 'unknown duration' : transportClock(duration)}
      </span>
    </div>
    <p className="hint seek-note" id={noteId}>{unavailable ? unavailableWords : seekBlocked ? CANT_SEEK : ' '}</p>
    </>
  );
}
