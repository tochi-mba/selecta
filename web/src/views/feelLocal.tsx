import { CSSProperties, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BlendArt } from '../cloud/BlendArt';
import { feelCalm, feelOn } from '../feel/root';
import { flashOnce } from '../feel/flashOnce';
import { Moment, type MomentKind } from '../feel/moment';
import { useApi } from '../requestContext';
import { CoverArt } from './CoverArt';
import { useFeelOn } from './feelPieces';

/** Feel pieces for the local app's own screens (ADR-0477, plan 3.15): the first scan, export, the
 * Workspace jobs and the not-found page. Each one draws nothing, or exactly what was there before,
 * while the feel is off. Styles: styles/feel-local.css. */

/** One stage's ring on the first-scan page, filled to a real count of a real total (files looked
 * at, songs analysed, songs ready). It is only drawn where the total is known: a ring that moved
 * without one would be a guess. The count beside it is the same number in words. */
export function StageRing({ label, value, max, valueText }: { label: string; value: number; max: number; valueText: string }) {
  const top = max > 0 ? max : 1;
  const now = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), top);
  const fraction = now / top;
  return (
    <svg className="stage-ring" viewBox="0 0 36 36" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={top}
      aria-valuenow={now} aria-valuetext={valueText} data-complete={fraction >= 1 ? '' : undefined} focusable="false">
      <circle className="stage-ring-track" cx="18" cy="18" r="15" pathLength={1} />
      <circle className="stage-ring-fill" cx="18" cy="18" r="15" pathLength={1} style={{ strokeDashoffset: 1 - fraction } as CSSProperties} />
    </svg>
  );
}

type FoundSong = { id: number };
const COVERS_SHOWN = 8;

/** The covers of the songs the scan has really saved so far, newest first, read again each time the
 * found count changes, so each new song's cover arrives as it is found. The file's own picture where
 * it has one, the generated tile otherwise. Decoration: the counts above say what was found. */
export function FoundCovers({ found }: { found: number }) {
  const feel = useFeelOn();
  const { get } = useApi();
  const [songs, setSongs] = useState<FoundSong[]>([]);
  useEffect(() => {
    if (!feel || found <= 0) return undefined;
    let live = true;
    get<FoundSong[]>(`/songs?order=recent&limit=${COVERS_SHOWN}`)
      .then((list) => {
        if (live && Array.isArray(list)) setSongs(list.filter((song) => Number.isSafeInteger(song?.id)).slice(0, COVERS_SHOWN));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [feel, found]);
  if (!feel || !songs.length) return null;
  return (
    <ul className="scan-covers" aria-hidden="true">
      {songs.map((song) => <li key={song.id} data-arrive=""><CoverArt seed={song.id} songId={song.id} size="small" /></li>)}
    </ul>
  );
}

/** The finished file's outline, from the peaks the server measured while it decoded the written
 * file to verify it (export_validation.py), mirrored about the middle. It draws across once with
 * motion on and simply appears otherwise. Decoration: the words beside it say the file is ready. */
export function ExportShape({ shape }: { shape: number[] | null | undefined }) {
  const points = (shape ?? []).filter((value) => Number.isFinite(value)).map((value) => Math.min(Math.max(value, 0.01), 1));
  if (points.length < 2) return null;
  const half = 20;
  const top = points.map((value, index) => `${index === 0 ? 'M' : 'L'}${index} ${(half - value * half).toFixed(2)}`).join(' ');
  const bottom = [...points].reverse().map((value, index) => `L${points.length - 1 - index} ${(half + value * half).toFixed(2)}`).join(' ');
  return (
    <svg className="export-shape" viewBox={`0 0 ${points.length - 1} ${half * 2}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={`${top} ${bottom} Z`} />
    </svg>
  );
}

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
    flashOnce(element);
  }, [done]);
}

/** Glow a row once when it first appears, for a row that is new since the list was last drawn. */
export function useFlashOnArrival(ref: RefObject<HTMLElement | null>, fresh: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!fresh || !element || !feelOn('motion') || feelCalm()) return;
    flashOnce(element);
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
