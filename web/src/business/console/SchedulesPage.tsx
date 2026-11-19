// S2 Schedules (ADR-0453 D7, BZ-0453-10; ADR-0444): the ScheduleBoard. Venues are rows, the day
// in each venue's own time runs across, dayparts are blocks. Choose venues, apply a template or
// edit one block, check the ScheduleDiffPreview (how many venues, how many are open now), settle
// any conflict with another editor per venue, then apply. Viewers, read-only organisations and an
// offline console see the board without the apply controls.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import type { ApplyPreview } from '../client';
import { PATHS, useBusiness } from '../context';
import { SCHEDULE_COPY } from '../copy/console';
import { DAYPART_COPY } from '../copy/onboarding';
import { TEMPLATES } from '../forms/DaypartBar';
import { clock, duration, venueTime } from '../time';
import type { Daypart, Venue, ZoneSchedule } from '../types';
import { blockPieces, firstName, loadSchedules, parseClock, toClock, venuesAfterChoices, versionsFor, type ConflictChoice } from './scheduleLogic';
import './console.css';

type TemplateId = (typeof TEMPLATES)[number]['id'];
type Change = { venueIds: string[]; template?: TemplateId; dayparts?: Daypart[] };
type Editing = { venue: Venue; zoneId: string; part: Daypart; name: string; start: string; end: string; error: string };
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const span = (parts: Daypart[]) => parts.map((part) => `${part.name} ${clock(part.start)} to ${clock(part.end)}`).join(', ') || SCHEDULE_COPY.noSchedule;

export function SchedulesPage() {
  const { org, venues, client, go, now, readOnly, offline } = useBusiness();
  const [schedules, setSchedules] = useState<Record<string, ZoneSchedule>>({});
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [template, setTemplate] = useState<TemplateId | ''>('');
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [preview, setPreview] = useState<{ change: Change; result: ApplyPreview } | null>(null);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [done, setDone] = useState('');
  const canApply = org.role !== 'viewer' && !readOnly && !offline;
  const zoneIds = useMemo(() => venues.flatMap((venue) => venue.zones.map((zone) => zone.id)), [venues]);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setSchedules(await loadSchedules(client, zoneIds)); } finally { setLoading(false); }
  }, [client, zoneIds]);
  useEffect(() => { void reload(); }, [reload]);

  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));
  const ask = async (change: Change) => {
    setDone('');
    const result = await client.previewApply(org.id, { venue_ids: change.venueIds, template: change.template, dayparts: change.dayparts });
    setChoices({});
    setPreview({ change, result });
  };
  const previewTemplate = async () => {
    if (!chosen.length) { setProblem(SCHEDULE_COPY.chooseVenuesFirst); return; }
    if (!template) { setProblem(SCHEDULE_COPY.pickTemplateFirst); return; }
    setProblem('');
    await ask({ venueIds: chosen, template });
  };
  const previewEdit = async () => {
    if (!editing) return;
    const start = parseClock(editing.start);
    const end = parseClock(editing.end);
    if (start == null || end == null) { setEditing({ ...editing, error: SCHEDULE_COPY.badTime }); return; }
    if (end <= start) { setEditing({ ...editing, error: SCHEDULE_COPY.endBeforeStart }); return; }
    const parts = schedules[editing.zoneId]?.dayparts ?? [];
    const dayparts = parts.map((part) => (part.id === editing.part.id ? { ...part, name: editing.name.trim() || part.name, start, end } : part));
    const venueId = editing.venue.id;
    setEditing(null);
    await ask({ venueIds: [venueId], dayparts });
  };
  const apply = async () => {
    if (!preview) return;
    const { change, result } = preview;
    const venueIds = venuesAfterChoices(change.venueIds, result, choices);
    if (!venueIds.length) { setPreview(null); setDone(SCHEDULE_COPY.nothingToApply); return; }
    const answer = await client.apply(org.id, { venue_ids: venueIds, template: change.template, dayparts: change.dayparts, versions: versionsFor(venueIds, venues, schedules) });
    setPreview(null);
    setChosen([]);
    setDone(SCHEDULE_COPY.applied(answer?.applied ?? venueIds.length));
    await reload();
  };

  return <section className="biz biz-stack">
    <h1>{SCHEDULE_COPY.title}</h1>
    <p className="biz-quiet">{SCHEDULE_COPY.intro}</p>
    {loading && <p role="status">{SCHEDULE_COPY.loading}</p>}
    {!loading && !venues.length && <p>No venues yet. Add a venue to set its music schedule.</p>}
    {canApply && venues.length > 0 && <div className="sched-tools">
      <p role="status">{SCHEDULE_COPY.selectedCount(chosen.length)}</p>
      <button type="button" onClick={() => setChosen(venues.map((venue) => venue.id))}>{SCHEDULE_COPY.chooseAll}</button>
      <button type="button" onClick={() => setChosen([])}>{SCHEDULE_COPY.chooseNone}</button>
      <Select<TemplateId | ''> label={SCHEDULE_COPY.templateLabel} value={template} onChange={setTemplate}
        options={[{ value: '', label: SCHEDULE_COPY.pickTemplate }, ...TEMPLATES.map((item) => ({ value: item.id, label: item.name }))]} />
      <Action run={previewTemplate}>{SCHEDULE_COPY.previewChanges}</Action>
      {problem && <p role="alert">{problem}</p>}
    </div>}
    {done && <p role="status">{done}</p>}
    {venues.length > 0 && <div className="sched-scroll" role="region" aria-label={SCHEDULE_COPY.boardLabel} tabIndex={0}><div className="sched-board">
      <div className="sched-row" aria-hidden="true"><span /><div className="sched-hours">{HOURS.map((hour) => <span key={hour}>{SCHEDULE_COPY.hourColumn(toClock(hour * 60))}</span>)}</div></div>
      {venues.map((venue) => <section key={venue.id} className="sched-row" aria-labelledby={`sched-${venue.id}`}>
        <div className="sched-venue">
          {canApply
            ? <label><input type="checkbox" aria-label={SCHEDULE_COPY.selectVenue(venue.name)} checked={chosen.includes(venue.id)} onChange={() => toggle(venue.id)} /><strong id={`sched-${venue.id}`}>{venue.name}</strong></label>
            : <strong id={`sched-${venue.id}`}>{venue.name}</strong>}
          <span className="biz-quiet">{SCHEDULE_COPY.venueNow(venueTime(now, venue.time_zone))}</span>
          <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'schedule'))}>Open venue schedule</button>
        </div>
        <div className="sched-lanes">
          {!venue.zones.length && <p>No zones yet</p>}
          {venue.zones.map((zone) => {
            const parts = schedules[zone.id]?.dayparts ?? [];
            return <div key={zone.id}>
              <div className="sched-lane-name">{zone.name}{!parts.length && `: ${loading ? SCHEDULE_COPY.loading : SCHEDULE_COPY.noSchedule}`}</div>
              {parts.length > 0 && <div className="sched-lane">
                {parts.flatMap((part) => blockPieces(part).map((piece, index) => {
                  const words = SCHEDULE_COPY.block(part.name, clock(part.start), clock(part.end), DAYPART_COPY.energy[part.energy]);
                  const style = { left: `${piece.left}%`, width: `${piece.width}%` };
                  const key = `${part.id}-${index}`;
                  return canApply
                    ? <button key={key} type="button" className="sched-block" data-energy={part.energy} style={style} aria-label={words}
                      onClick={() => setEditing({ venue, zoneId: zone.id, part, name: part.name, start: toClock(part.start), end: toClock(part.end), error: '' })}>{part.name}</button>
                    : <span key={key} className="sched-block" data-energy={part.energy} style={style} title={words}>{part.name}<span className="visually-hidden">, {words}</span></span>;
                }))}
              </div>}
            </div>;
          })}
        </div>
      </section>)}
    </div></div>}
    {editing && <section className="biz-card biz-stack" aria-labelledby="sched-edit-title">
      <h2 id="sched-edit-title">{SCHEDULE_COPY.editBlockTitle(editing.part.name)}</h2>
      <TextField label={SCHEDULE_COPY.blockName} value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
      <TextField label={SCHEDULE_COPY.blockStart} value={editing.start} onChange={(start) => setEditing({ ...editing, start, error: '' })} />
      <TextField label={SCHEDULE_COPY.blockEnd} value={editing.end} error={editing.error || undefined} onChange={(end) => setEditing({ ...editing, end, error: '' })} />
      <div className="biz-row">
        <Action run={previewEdit}>{SCHEDULE_COPY.previewEdit}</Action>
        <button type="button" onClick={() => setEditing(null)}>{SCHEDULE_COPY.cancel}</button>
      </div>
    </section>}
    {preview && <section className="biz-card biz-stack" aria-labelledby="sched-diff-title">
      <h2 id="sched-diff-title">{SCHEDULE_COPY.diffTitle}</h2>
      <p>{SCHEDULE_COPY.diffSummary(preview.result.venues, preview.result.open_now)}</p>
      {preview.result.conflicts.length > 0 && <>
        <h3>{SCHEDULE_COPY.conflictHeading}</h3>
        <ul>{preview.result.conflicts.map((conflict) => {
          const name = venues.find((item) => item.id === conflict.venue_id)?.name ?? conflict.venue_id;
          const choice = choices[conflict.venue_id] ?? 'mine';
          const pick = (value: ConflictChoice) => setChoices({ ...choices, [conflict.venue_id]: value });
          return <li key={`${conflict.venue_id}-${conflict.zone_id}`} className="sched-conflict">
            <p><strong>{name}</strong>: {SCHEDULE_COPY.changedBy(firstName(conflict.updated_by), duration(now - conflict.updated_at))}</p>
            <div className="sched-versions">
              <div><h4>{SCHEDULE_COPY.theirs}</h4><p>{span(conflict.theirs)}</p></div>
              <div><h4>{SCHEDULE_COPY.mine}</h4><p>{span(conflict.ours)}</p></div>
            </div>
            <fieldset><legend className="visually-hidden">{name}</legend>
              <label><input type="radio" name={`keep-${conflict.venue_id}`} checked={choice === 'mine'} onChange={() => pick('mine')} /> {SCHEDULE_COPY.keepMine}</label>
              <label><input type="radio" name={`keep-${conflict.venue_id}`} checked={choice === 'theirs'} onChange={() => pick('theirs')} /> {SCHEDULE_COPY.keepTheirs}</label>
            </fieldset>
          </li>;
        })}</ul>
      </>}
      <div className="biz-row">
        <Action run={apply} working={SCHEDULE_COPY.applying}>{SCHEDULE_COPY.apply}</Action>
        <button type="button" onClick={() => setPreview(null)}>{SCHEDULE_COPY.cancel}</button>
      </div>
    </section>}
  </section>;
}
