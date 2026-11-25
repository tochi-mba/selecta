// The live blend (ADR-0477, plan 3.4): what Listen shows while one song really hands over to the
// next. Split out of Now.tsx (file length limit).
//
// Everything drawn here is measured: the two songs' own waveform peaks over the stretch the
// hand-over covers, and a line at the hand-over's real progress (feel/hue.ts handoverProgress, the
// same sum Listen's hand-over bar and the ambient colour use). Nothing moves unless the song clock
// does, so a pause holds it still. Where the next song's peaks cannot be read in this mode, only the
// song that is playing is drawn, and the drawing says so.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MixItem, SongDetail } from '../api';
import type { NowState } from '../player';
import { handoverProgress } from '../feel/hue';
import { useFeelPart } from './feelBits';

/** How close the seam is, in seconds, when the next song's card rises and its peaks are fetched. */
export const NEAR_SEAM_S = 20;
/** Bars drawn in each lane. */
const BARS = 48;

/** True while a real, scheduled hand-over is close and the music is playing. */
export function nearSeam(now: Pick<NowState, 'phase' | 'inSeam' | 'seamAt' | 'songTime'>): boolean {
  return now.phase === 'playing' && !now.inSeam && now.seamAt !== null && now.seamAt - now.songTime >= 0 && now.seamAt - now.songTime <= NEAR_SEAM_S;
}

/** A song's peaks over a stretch of it, resampled to `BARS` bars. Empty when the song's length is unknown. */
function stretch(peaks: readonly number[], duration: number, from: number, span: number): number[] {
  if (!peaks.length || !(duration > 0) || !(span > 0)) return [];
  return Array.from({ length: BARS }, (_, index) => {
    const at = from + (span * (index + 0.5)) / BARS;
    const sample = Math.floor((at / duration) * peaks.length);
    return sample >= 0 && sample < peaks.length ? Math.max(0, Math.min(1, peaks[sample])) : 0;
  });
}

function lane(levels: number[], middle: number, half: number): string {
  const step = 100 / BARS;
  return levels.map((level, index) => {
    const height = Math.max(level * half * 2, 0.6);
    return `M${(index * step + step / 2).toFixed(2)} ${(middle - height / 2).toFixed(2)}v${height.toFixed(2)}`;
  }).join('');
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

  const seamAt = now.seamAt ?? 0;
  const span = switchAt ?? 0;
  const outShape = useMemo(
    () => (detail && handing ? lane(stretch(detail.peaks, detail.duration, seamAt, span), 12, 10) : ''),
    [detail, handing, seamAt, span],
  );
  const inPeaks = incoming && entering && incoming.id === entering.song_id ? incoming.peaks : null;
  // a length the catalogue lacks is the one the engine decoded; where the song came in, likewise
  const inLength = entering?.duration || now.blend?.nextLength || 0;
  const inFrom = now.blend?.nextFrom ?? 0;
  const inShape = useMemo(
    () => (inPeaks && entering && handing ? lane(stretch(inPeaks, inLength, inFrom, span), 36, 10) : ''),
    [inPeaks, entering, handing, inLength, inFrom, span],
  );

  if (!on || !handing || !leaving || !entering || !detail || detail.id !== leaving.song_id || !outShape) return null;
  const progress = handoverProgress(now.songTime, seamAt, switchAt);
  const at = (progress * 100).toFixed(2);
  const move = entering.seam?.state?.label;
  // decoration: the hand-over section around it already says, in words, what is happening
  return (
    <div className="live-blend" aria-hidden="true" data-incoming={inShape ? 'measured' : 'missing'}>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" focusable="false">
        <defs>
          <clipPath id={clip}><rect x="0" y="0" width={at} height="48" /></clipPath>
        </defs>
        <path className="live-blend-out" d={outShape} vectorEffect="non-scaling-stroke" />
        <path className="live-blend-out played" d={outShape} clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />
        {inShape && <path className="live-blend-in" d={inShape} vectorEffect="non-scaling-stroke" />}
        {inShape && <path className="live-blend-in played" d={inShape} clipPath={`url(#${clip})`} vectorEffect="non-scaling-stroke" />}
        <line className="live-blend-head" x1={at} y1="0" x2={at} y2="48" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="live-blend-caption">
        {move ? <b>{move}</b> : null}
        {!inShape && <span>The next song’s waveform can’t be read here, so only this song is drawn.</span>}
      </p>
    </div>
  );
}
