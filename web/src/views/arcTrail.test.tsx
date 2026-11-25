import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { curveAt, TRAIL_POINTS, trailPath, useArcTrail } from './arcTrail';

/** ADR-0477, plan 3.3: the energy arc's trail follows the pointer only and settles onto the curve. */

const VALUES = [0, 50, 100, 50, 0];

function pointer(x: number, y: number): PointerEvent<SVGSVGElement> {
  const box = { left: 0, top: 0, width: 100, height: 40 };
  return { clientX: x, clientY: y, currentTarget: { getBoundingClientRect: () => box } } as unknown as PointerEvent<SVGSVGElement>;
}

describe('energy arc trail', () => {
  it('reads the curve between its stops the way EnergyHorizon draws it', () => {
    expect(curveAt(VALUES, 0)).toBe(38);
    expect(curveAt(VALUES, 50)).toBeCloseTo(4);
    expect(curveAt(VALUES, 12.5)).toBeCloseTo(38 - 25 * 0.34);
    // outside the box it holds the end stops
    expect(curveAt(VALUES, 140)).toBe(38);
  });

  it('draws one straight step per point, so a settled path has the same steps', () => {
    expect(trailPath([[0, 1], [10, 2.25]])).toBe('M0.0 1.0 L10.0 2.3');
  });

  it('draws nothing when the feel cannot move (the default in tests is calm or off)', () => {
    const { result } = renderHook(() => useArcTrail(VALUES));
    act(() => result.current.start(pointer(10, 10)));
    act(() => result.current.add(pointer(20, 12)));
    // with motion off there is only the curve; with it on, the trail keeps at most TRAIL_POINTS
    if (result.current.trail === null) {
      expect(result.current.trail).toBeNull();
    } else {
      for (let step = 0; step < TRAIL_POINTS + 5; step += 1) act(() => result.current.add(pointer(step, 10)));
      const d = (result.current.trail as { props: { d: string } }).props.d;
      expect(d.split(/[ML]/).filter(Boolean)).toHaveLength(TRAIL_POINTS);
      act(() => result.current.end());
      const settled = (result.current.trail as { props: { d: string; 'data-settled'?: boolean } }).props;
      expect(settled['data-settled']).toBe(true);
    }
  });

  it('goes at once when the drawing is abandoned', () => {
    const { result } = renderHook(() => useArcTrail(VALUES));
    act(() => result.current.start(pointer(10, 10)));
    act(() => result.current.add(pointer(20, 12)));
    act(() => result.current.abandon());
    expect(result.current.trail).toBeNull();
  });
});
