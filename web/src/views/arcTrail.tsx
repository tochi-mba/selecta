// The energy arc's drawing trail (ADR-0477, plan 3.3): while someone draws the arc, the last stretch
// of their pointer's path glows behind it, and when they let go that stretch settles onto the curve
// they drew and fades. Only the pointer moves it: each point is a real pointer position, nothing is
// added on a timer, and the settling is one transition started by letting go. With Still, reduced
// motion or low power (feelCalm) and with the motion part off there is no trail, only the curve.
import { type PointerEvent, useCallback, useRef, useState } from 'react';
import { feelCalm, feelOn } from '../feel/root';

/** How many of the latest pointer positions the trail keeps: enough to read as a stroke, short
 * enough that it follows the pointer rather than repeating the curve. */
export const TRAIL_POINTS = 18;

type Point = readonly [number, number];

/** The drawn curve's height at `x` (0 to 100) in the arc's 100 by 40 box, between its five stops,
 * the same mapping EnergyHorizon draws with. */
export function curveAt(values: readonly number[], x: number): number {
  const along = Math.max(0, Math.min(100, x)) / 25;
  const left = Math.min(3, Math.floor(along));
  const part = along - left;
  const from = 38 - (values[left] ?? 0) * 0.34;
  const to = 38 - (values[left + 1] ?? 0) * 0.34;
  return from + (to - from) * part;
}

/** An SVG path through the points, one straight step each, so a path of the same length can glide
 * into it (the browser can only move a path whose steps match). */
export function trailPath(points: readonly Point[]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
}

/** Where a pointer is in the arc's 100 by 40 box. */
function pointIn(event: PointerEvent<SVGSVGElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / (bounds.width || 1)) * 100;
  const y = ((event.clientY - bounds.top) / (bounds.height || 1)) * 40;
  return [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(40, y))];
}

/** The trail for one energy arc. `values` is the curve as drawn now. Call `start`, `add` and `end`
 * from the arc's own pointer handlers, `clear` when a pointer is cancelled, and `abandon` when the
 * drawing stops some other way. */
export function useArcTrail(values: readonly number[]) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [settled, setSettled] = useState(false);
  const drawing = useRef(false);
  const allowed = () => feelOn('motion') && !feelCalm();

  const start = (event: PointerEvent<SVGSVGElement>) => {
    drawing.current = allowed();
    setSettled(false);
    setPoints(drawing.current ? [pointIn(event)] : null);
  };
  const add = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const next = pointIn(event);
    setPoints((before) => (before ? [...before, next].slice(-TRAIL_POINTS) : before));
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSettled(true);
  };
  const clear = useCallback(() => {
    drawing.current = false;
    setPoints(null);
    setSettled(false);
  }, []);
  /** A drawing that ended without letting go (Escape): the trail goes. After `end` this does nothing. */
  const abandon = useCallback(() => {
    if (drawing.current) clear();
  }, [clear]);

  // settled, every point lies on the curve at its own place along it, so the stroke glides down onto
  // the line and fades there (feel-library.css); once that has played the trail is gone
  const shape = points && points.length > 1
    ? trailPath(settled ? points.map(([x]) => [x, curveAt(values, x)] as const) : points)
    : null;
  const trail = shape ? (
    <path className="energy-arc-trail" d={shape} data-settled={settled || undefined} vectorEffect="non-scaling-stroke"
      aria-hidden="true" onTransitionEnd={(event) => {
        if (settled && event.propertyName === 'opacity') setPoints(null);
      }} />
  ) : null;
  return { trail, start, add, end, clear, abandon };
}
