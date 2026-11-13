// DaypartBar (ADR-0453 D6 step 8, D14; ADR-0444): one day as a horizontal bar of programme
// blocks by energy, with names and times, the current time marked when given, and keyboard-editable
// boundaries plus a list editor when `onChange` is given. Energy is a word and a pattern, never
// colour alone; a text list repeats it all for screen readers. Reused by S2, S3 and S4.

import { KeyboardEvent } from 'react';
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
  const moveBoundary = (index: number, delta: number) => {
    const left = sorted[index];
    const right = sorted[index + 1];
    const at = Math.min(right.end - STEP, Math.max(left.start + STEP, left.end + delta));
    const touching = left.end === right.start;
    onChange?.(sorted.map((part, i) => (i === index ? { ...part, end: at } : i === index + 1 && touching ? { ...part, start: at } : part)));
  };
  const boundaryKeys = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? STEP : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -STEP : event.key === 'PageUp' ? 60 : event.key === 'PageDown' ? -60 : 0;
    if (!delta) return;
    event.preventDefault();
    moveBoundary(index, delta);
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
      {editable && <div className="bzf-boundaries">
        {sorted.slice(0, -1).map((part, index) => <div key={part.id} role="slider" tabIndex={0} className="bzf-boundary"
          aria-label={DAYPART_COPY.boundary(part.name, sorted[index + 1].name)}
          aria-valuemin={part.start + STEP} aria-valuemax={sorted[index + 1].end - STEP} aria-valuenow={part.end} aria-valuetext={clock(part.end)}
          style={{ left: pct(part.end) }} onKeyDown={(event) => boundaryKeys(event, index)}>
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
