// DaypartBar (ADR-0453 D6 step 8, D14; ADR-0444): one day as a horizontal bar of programme
// blocks by energy, with names and times, the current time marked when given, and keyboard-editable
// boundaries plus a list editor when `onChange` is given. Energy is a word and a pattern, never
// colour alone; a text list repeats it all for screen readers. Reused by S2, S3 and S4.

import { KeyboardEvent, PointerEvent, useRef } from 'react';
import { tick } from '../../feel/haptics';
import { feelOn } from '../../feel/root';
import { flagOn } from '../../flags';
import { DAYPART_COPY } from '../copy/onboarding';
import { clock } from '../time';
import type { Daypart } from '../types';
import { parseClock } from './hours';
import './forms.css';

export const TEMPLATES: { id: 'cafe_day' | 'bar_evening' | 'restaurant'; name: string; dayparts: Daypart[] }[] = [
  { id: 'cafe_day', name: 'Cafe day', dayparts: [
    { id: 'cafe-1', name: 'Morning calm', start: 420, end: 660, energy: 'calm' },
    { id: 'cafe-2', name: 'Lunch', start: 660, end: 840, energy: 'steady' },
    { id: 'cafe-3', name: 'Afternoon', start: 840, end: 1080, energy: 'calm' },
  ] },
  { id: 'bar_evening', name: 'Bar evening', dayparts: [
    { id: 'bar-1', name: 'Early evening', start: 1020, end: 1200, energy: 'steady' },
    { id: 'bar-2', name: 'Evening energy', start: 1200, end: 1380, energy: 'lifted' },
    { id: 'bar-3', name: 'Late peak', start: 1380, end: 1560, energy: 'peak' },
  ] },
  { id: 'restaurant', name: 'Restaurant', dayparts: [
    { id: 'rest-1', name: 'Brunch calm', start: 600, end: 720, energy: 'calm' },
    { id: 'rest-2', name: 'Lunch', start: 720, end: 900, energy: 'steady' },
    { id: 'rest-3', name: 'Dinner', start: 1080, end: 1320, energy: 'steady' },
    { id: 'rest-4', name: 'Late', start: 1320, end: 1410, energy: 'lifted' },
  ] },
];

const STEP = 15;
const ENERGIES: Daypart['energy'][] = ['calm', 'steady', 'lifted', 'peak'];

/** Where a dragged boundary lands for a pointer `x` pixels across a bar `width` wide showing `span`
 * minutes: on the nearest 15-minute step, and never past `min` or `max` (its neighbours' limits). */
export function boundaryAt(x: number, width: number, span: number, min: number, max: number, step = STEP): number {
  const raw = width > 0 ? (x / width) * span : min;
  return Math.min(max, Math.max(min, Math.round(raw / step) * step));
}

/** The block playing at a minute of the day, or null between blocks. */
export function daypartAt(dayparts: Daypart[], minutes: number): Daypart | null {
  return dayparts.find((part) => (minutes >= part.start && minutes < part.end) || (minutes + 1440 >= part.start && minutes + 1440 < part.end)) ?? null;
}

export function DaypartBar({ dayparts, label, nowMinutes, onChange, disabled }: {
  dayparts: Daypart[]; label: string; nowMinutes?: number | null; onChange?: (d: Daypart[]) => void; disabled?: string | null;
}) {
  const sorted = [...dayparts].sort((a, b) => a.start - b.start);
  const span = Math.max(1440, ...sorted.map((part) => part.end));
  const pct = (minutes: number) => `${(minutes / span) * 100}%`;
  const editable = Boolean(onChange) && !disabled;
  const words = (part: Daypart) => DAYPART_COPY.textEquivalent(part.name, DAYPART_COPY.energy[part.energy], clock(part.start), clock(part.end));

  const update = (id: string, change: Partial<Daypart>) => onChange?.(sorted.map((part) => (part.id === id ? { ...part, ...change } : part)));
  const limits = (index: number) => [sorted[index].start + STEP, sorted[index + 1].end - STEP] as const;
  const setBoundary = (index: number, minutes: number) => {
    const left = sorted[index];
    const right = sorted[index + 1];
    const [min, max] = limits(index);
    const at = Math.min(max, Math.max(min, minutes));
    const touching = left.end === right.start;
    onChange?.(sorted.map((part, i) => (i === index ? { ...part, end: at } : i === index + 1 && touching ? { ...part, start: at } : part)));
  };
  const boundaryKeys = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? STEP : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -STEP : event.key === 'PageUp' ? 60 : event.key === 'PageDown' ? -60 : 0;
    if (!delta) return;
    event.preventDefault();
    setBoundary(index, sorted[index].end + delta);
  };

  // Dragging a boundary (ADR-0477 plan 3.14), with app.feel_motion on; off, the boundaries move by
  // keyboard and the list below, as before. The times snap to 15-minute steps as the pointer moves,
  // each step a small tick on a phone. With motion on the handle follows the pointer between steps
  // and glides onto the step it landed on when let go (forms.css); in Still it simply snaps. The
  // offset is written on the handle alone, so nothing re-renders between steps.
  const draggable = editable && flagOn('app.feel_motion');
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ index: number; at: number } | null>(null);
  const grab = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (!draggable || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.dataset.dragging = '';
    dragging.current = { index, at: sorted[index].end };
  };
  const follow = (event: PointerEvent<HTMLDivElement>, index: number) => {
    const held = dragging.current;
    const box = track.current?.getBoundingClientRect();
    if (!held || held.index !== index || !box || box.width <= 0) return;
    const [min, max] = limits(index);
    const x = Math.min((max / span) * box.width, Math.max((min / span) * box.width, event.clientX - box.left));
    const at = boundaryAt(x, box.width, span, min, max);
    if (at !== held.at) {
      held.at = at;
      tick();
      setBoundary(index, at);
    }
    if (feelOn('motion')) event.currentTarget.style.translate = `${Math.round(x - (at / span) * box.width)}px 0`;
  };
  const letGo = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    delete event.currentTarget.dataset.dragging;
    event.currentTarget.style.translate = '';
  };

  return <figure className="bzf-daypart" aria-label={label}>
    <figcaption className="visually-hidden">{label}</figcaption>
    {!sorted.length ? <p className="biz-quiet">{DAYPART_COPY.empty}</p> : <>
      <div className="bzf-daypart-bar" aria-hidden="true">
        {sorted.map((part) => <div key={part.id} className={`bzf-block bzf-energy-${part.energy}`} style={{ left: pct(part.start), width: pct(part.end - part.start) }} title={words(part)}>
          <span className="bzf-block-name">{part.name}</span>
          <span className="bzf-block-time">{clock(part.start, false)} to {clock(part.end, false)}</span>
          <span className="bzf-block-energy">{DAYPART_COPY.energy[part.energy]}</span>
        </div>)}
        {nowMinutes != null && <div className="bzf-now" style={{ left: pct(nowMinutes) }}><span>{DAYPART_COPY.now}</span></div>}
      </div>
      {editable && <div ref={track} className="bzf-boundaries">
        {sorted.slice(0, -1).map((part, index) => <div key={part.id} role="slider" tabIndex={0} className="bzf-boundary"
          aria-label={DAYPART_COPY.boundary(part.name, sorted[index + 1].name)}
          aria-valuemin={part.start + STEP} aria-valuemax={sorted[index + 1].end - STEP} aria-valuenow={part.end} aria-valuetext={clock(part.end)}
          style={{ left: pct(part.end) }} onKeyDown={(event) => boundaryKeys(event, index)}
          data-drag={draggable || undefined} onPointerDown={(event) => grab(event, index)} onPointerMove={(event) => follow(event, index)}
          onPointerUp={letGo} onPointerCancel={letGo} onLostPointerCapture={letGo}>
          <span className="visually-hidden">{clock(part.end)}</span>
        </div>)}
      </div>}
      <ul className="visually-hidden" aria-label={DAYPART_COPY.blocks}>
        {sorted.map((part) => <li key={part.id}>{words(part)}</li>)}
        {nowMinutes != null && <li>{DAYPART_COPY.now}: {clock(nowMinutes)}{daypartAt(sorted, nowMinutes) ? `, ${daypartAt(sorted, nowMinutes)!.name}` : ''}</li>}
      </ul>
    </>}
    {editable && sorted.length > 0 && <table className="bzf-daypart-list">
      <caption className="visually-hidden">{DAYPART_COPY.blocks}</caption>
      <thead><tr><th scope="col">{DAYPART_COPY.name}</th><th scope="col">{DAYPART_COPY.starts}</th><th scope="col">{DAYPART_COPY.ends}</th><th scope="col">{DAYPART_COPY.energyLabel}</th></tr></thead>
      <tbody>{sorted.map((part) => <tr key={part.id}>
        <td><input aria-label={`${DAYPART_COPY.name}, ${part.name}`} value={part.name} onChange={(event) => update(part.id, { name: event.target.value })} /></td>
        <td><input type="time" aria-label={`${part.name} ${DAYPART_COPY.starts}`} value={clock(part.start, false)} onChange={(event) => { const at = parseClock(event.target.value); if (at != null) update(part.id, { start: at }); }} /></td>
        <td><input type="time" aria-label={`${part.name} ${DAYPART_COPY.ends}`} value={clock(part.end, false)} onChange={(event) => { const at = parseClock(event.target.value); if (at != null) update(part.id, { end: at <= part.start ? at + 1440 : at }); }} /></td>
        <td><select aria-label={`${part.name} ${DAYPART_COPY.energyLabel}`} value={part.energy} onChange={(event) => update(part.id, { energy: event.target.value as Daypart['energy'] })}>
          {ENERGIES.map((energy) => <option key={energy} value={energy}>{DAYPART_COPY.energy[energy]}</option>)}
        </select></td>
      </tr>)}</tbody>
    </table>}
    {disabled && onChange && <p className="biz-quiet">{disabled}</p>}
  </figure>;
}
