// VolumeLimitSlider (ADR-0453 D10, D14): the existing Slider, with the venue's cap drawn as a mark
// and said in words ("Up to 70 here"). The range itself ends at the cap, so a value above it
// cannot be chosen by pointer, keyboard or assistive tech; the track past the cap is drawn as
// unavailable so the cap reads in proportion to the whole volume.

import { useId, useRef, type CSSProperties } from 'react';
import { tap } from '../../feel/haptics';
import { flagOn } from '../../flags';
import { Slider } from '../../ui/primitives';
import { capWords, volumeValueText } from '../copy/staff';
import './staff.css';

export function clampLevel(level: number, cap: number): number {
  const top = Math.max(0, Math.min(100, Math.round(cap)));
  return Math.max(0, Math.min(top, Math.round(level)));
}

/** The levels a dragged thumb settles on (a quarter, a half, three quarters), so the usual levels
 * are easy to find with a thumb on a busy night. */
export const DETENTS = [25, 50, 75] as const;
/** How close, in steps, a dragged level must come to a detent to land on it. */
const DETENT_REACH = 2;

/** The detents below the cap. */
export function detentsBelow(top: number): number[] {
  return DETENTS.filter((stop) => stop < top);
}

/** A dragged level close to a detent lands on it; any other level stays as it is. */
export function settleOnDetent(level: number, top: number): number {
  return detentsBelow(top).find((stop) => Math.abs(level - stop) <= DETENT_REACH) ?? level;
}

export function VolumeLimitSlider({ label, value, cap, onChange, disabled }: {
  label: string; value: number; cap: number; onChange: (level: number) => void; disabled?: string | null;
}) {
  const top = clampLevel(cap, 100);
  const shown = clampLevel(value, top);
  const style = { '--biz-cap': `${top}%` } as CSSProperties;
  // Detents (ADR-0477 plan 3.14), with app.feel_motion on. Only a drag settles on them: the keyboard
  // still moves one step at a time, so every level stays reachable. The browser draws a mark at each
  // detent from the list, and landing on one is a firmer tap on a phone than the per-step tick.
  const detents = flagOn('app.feel_motion') ? detentsBelow(top) : [];
  const listId = useId();
  const dragging = useRef(false);
  const change = (raw: number) => {
    const level = detents.length && dragging.current ? settleOnDetent(clampLevel(raw, top), top) : clampLevel(raw, top);
    if (level !== shown && detents.includes(level)) tap();
    onChange(level);
  };
  return (
    <div className="biz-volume" style={style} data-cap={top}>
      <div className="biz-volume-head">
        <span className="biz-volume-label" aria-hidden="true">{label}</span>
        <span className="biz-volume-value" aria-hidden="true">{shown}</span>
      </div>
      <div className="biz-volume-track" onPointerDown={() => { dragging.current = true; }}
        onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
        // a key always moves one plain step, even if a pointer's release was missed
        onKeyDown={() => { dragging.current = false; }}>
        <Slider
          list={detents.length ? listId : undefined}
          label={label}
          min={0}
          max={top}
          step={1}
          value={shown}
          valueText={volumeValueText(shown, top)}
          disabled={Boolean(disabled)}
          title={disabled ?? undefined}
          // the shared Slider already ticks once per step on a phone (ADR-0477), at most every 40ms
          onChange={(event) => change(Number(event.currentTarget.value))}
        />
        {detents.length > 0 && <datalist id={listId}>{detents.map((stop) => <option key={stop} value={stop} />)}</datalist>}
        <span className="biz-volume-beyond" aria-hidden="true" />
        <span className="biz-volume-mark" aria-hidden="true" />
      </div>
      <p className="biz-quiet biz-volume-cap">{capWords(top)}{disabled ? `. ${disabled}` : ''}</p>
    </div>
  );
}
