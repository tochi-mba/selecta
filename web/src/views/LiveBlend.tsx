// The live blend (ADR-0477, plan 3.4): what Listen shows while one song really hands over to the
// next. Split out of Now.tsx (file length limit).
//
// Everything drawn here is measured: the two songs' own waveform peaks on one shared timeline, and
// a line at the real time in the hand-over. The outgoing song is drawn from LEAD_S seconds before
// the hand-over starts to where it ends, so its lane shows the music leading in and not only its
// quiet last seconds; the incoming song is drawn from the moment it really came in, from the point
// in it where it entered. Nothing moves unless the song clock does, so a pause holds it still, and
// nothing is animated between two clock steps, so Still and reduced motion see the same picture.
// Where the next song's peaks cannot be had, only the song that is playing is drawn, and the
// drawing says so.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MixItem, SongDetail } from '../api';
import type { NowState } from '../player';
import { useFeelPart } from './feelBits';

/** How close the seam is, in seconds, when the next song's card rises and its peaks are fetched. */
export const NEAR_SEAM_S = 20;
/** The most seconds of the outgoing song drawn before the hand-over starts. */
export const LEAD_S = 20;
/** Bars across the whole drawing; a lane that covers part of it gets its share. */
const BARS = 72;
/** The drawing's own units: 100 wide, two lanes of LANE high with a gap between. */
const LANE = 20;
const HIGH = LANE * 2 + 4;
const OUT_MIDDLE = LANE / 2;
const IN_MIDDLE = HIGH - LANE / 2;

/** True while a real, scheduled hand-over is close and the music is playing. */
export function nearSeam(now: Pick<NowState, 'phase' | 'inSeam' | 'seamAt' | 'songTime'>): boolean {
  return now.phase === 'playing' && !now.inSeam && now.seamAt !== null && now.seamAt - now.songTime >= 0 && now.seamAt - now.songTime <= NEAR_SEAM_S;
}

/** One lane: a song's peaks between two of its own times (`from`, `to`, seconds), drawn as bars
 * between two places across the drawing (`left`, `right`, 0 to 100). Each bar is the loudest peak
 * its stretch of the song covers, so a short loud moment is not lost between two bars. Empty when
 * the song's length is unknown. */
export function laneOf(peaks: readonly number[], duration: number, from: number, to: number, left: number, right: number, middle: number): string {
  if (!peaks.length || !(duration > 0) || !(to > from) || !(right > left)) return '';
  const count = Math.max(1, Math.round(((right - left) / 100) * BARS));
  const step = (right - left) / count;
  const bin = (seconds: number) => Math.floor((seconds / duration) * peaks.length);
  let path = '';
  for (let index = 0; index < count; index += 1) {
    const first = bin(from + ((to - from) * index) / count);
    const last = Math.max(first, bin(from + ((to - from) * (index + 1)) / count) - 1);
    let level = 0;
    for (let sample = Math.max(0, first); sample <= Math.min(peaks.length - 1, last); sample += 1) level = Math.max(level, peaks[sample]);
    const height = Math.max(Math.min(1, level) * LANE, 0.6);
    path += `M${(left + step * (index + 0.5)).toFixed(2)} ${(middle - height / 2).toFixed(2)}v${height.toFixed(2)}`;
  }
  return path;
}

export function LiveBlend({ now, leaving, entering, detail, peaksOf }: {
  now: NowState;
  leaving?: MixItem;
  entering?: MixItem;
  /** The playing song's analysis (or waveform), as Listen holds it. */
  detail: SongDetail | null;
  /** Reads a song's peaks in this mode, or null where there are none. */
  peaksOf?: (songId: number) => Promise<number[] | null>;
}) {
  const on = useFeelPart('music');
  // useId's colons are not valid in a url(#...) reference
  const clip = `live-blend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const tail = now.inSeam && !!now.seamTail;
  // Cloud's mix items carry no switch point: there the engine's own hand-over length is the span
  const switchAt = entering?.seam?.state?.switch_at ?? now.blend?.window;
  const handing = now.inSeam && !tail && now.seamAt !== null && !!switchAt && switchAt > 0;
  const wanted = on && !!entering && (handing || nearSeam(now)) ? entering.song_id : null;

  // the next song's peaks, read once per song when the hand-over is close
  const [incoming, setIncoming] = useState<{ id: number; peaks: number[] | null } | null>(null);
  const reader = useRef(peaksOf);
  reader.current = peaksOf;
  useEffect(() => {
    if (wanted === null || incoming?.id === wanted) return;
    const read = reader.current;
    if (!read) {
      setIncoming({ id: wanted, peaks: null });
      return;
    }
    let live = true;
    read(wanted).then((peaks) => { if (live) setIncoming({ id: wanted, peaks: peaks?.length ? peaks : null }); })
      .catch(() => { if (live) setIncoming({ id: wanted, peaks: null }); });
    return () => { live = false; };
  }, [wanted, incoming?.id]);

  // one timeline, in the outgoing song's seconds: from the lead-in to the end of the hand-over
  const seamAt = now.seamAt ?? 0;
  const span = switchAt ?? 0;
  // a short move (an echo out lasts about three seconds) would be a sliver beside the full lead-in,
  // so the lead-in shrinks with it and the hand-over keeps at least a third of the drawing
  const lead = Math.min(LEAD_S, Math.max(6, span * 2));
  const start = Math.max(0, seamAt - lead);
  const end = seamAt + span;
  const across = (seconds: number) => (end > start ? Math.min(100, Math.max(0, ((seconds - start) / (end - start)) * 100)) : 0);
  const entry = across(seamAt);
  const outShape = useMemo(
    () => (detail && handing ? laneOf(detail.peaks, detail.duration, start, end, 0, 100, OUT_MIDDLE) : ''),
    [detail, handing, start, end],
  );
  const read = !!incoming && !!entering && incoming.id === entering.song_id;
  const inPeaks = read ? incoming.peaks : null;
  // a length the catalogue lacks is the one the engine decoded; where the song came in, likewise
  const inLength = entering?.duration || now.blend?.nextLength || 0;
  const inFrom = now.blend?.nextFrom ?? 0;
  const inShape = useMemo(
    () => (inPeaks && handing ? laneOf(inPeaks, inLength, inFrom, inFrom + span, entry, 100, IN_MIDDLE) : ''),
    [inPeaks, handing, inLength, inFrom, span, entry],
  );

  if (!on || !handing || !leaving || !entering || !detail || detail.id !== leaving.song_id || !outShape) return null;
  const at = across(now.songTime).toFixed(2);
  // only an answer of "none" is said; while the next song's peaks are still on their way, its lane waits
  const missing = read && !inShape;
  const move = entering.seam?.state?.label;
  // decoration: the hand-over section around it already says, in words, what is happening
  return (
    <div className="live-blend" aria-hidden="true" data-incoming={inShape ? 'measured' : missing ? 'missing' : 'reading'}>
      <p className="live-blend-lane" data-lane="out"><span>From</span> <b dir="auto">{leaving.title}</b></p>
      <svg viewBox={`0 0 100 ${HIGH}`} preserveAspectRatio="none" focusable="false">
        <defs>
          <clipPath id={clip}><rect x="0" y="0" width={at} height={HIGH} /></clipPath>
        </defs>
        <rect className="live-blend-window" x={entry.toFixed(2)} y="0" width={(100 - entry).toFixed(2)} height={HIGH} />
        <path className="live-blend-out" d={outShape} vectorEffect="non-scaling-stroke" />
        <path className="live-blend-out played" d={outShape} clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />
        {inShape && <path className="live-blend-in" d={inShape} vectorEffect="non-scaling-stroke" />}
        {inShape && <path className="live-blend-in played" d={inShape} clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />}
        <line className="live-blend-head" x1={at} y1="0" x2={at} y2={HIGH} vectorEffect="non-scaling-stroke" />
      </svg>
      {inShape && <p className="live-blend-lane" data-lane="in" style={entry > 50 ? { textAlign: 'end' } : { paddingInlineStart: `${entry.toFixed(2)}%` }}><span>Into</span> <b dir="auto">{entering.title}</b></p>}
      {(move || missing) && (
        <p className="live-blend-caption">
          {move ? <b>{move}</b> : null}
          {missing && <span>The next song’s waveform can’t be read here, so only this song is drawn.</span>}
        </p>
      )}
    </div>
  );
}
