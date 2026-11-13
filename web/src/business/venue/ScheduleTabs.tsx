// S3 Today and Schedule (ADR-0453 D8, ADR-0444): a DaypartBar per zone with the current position
// marked in venue time, and per-zone editing that saves with the schedule's version so a change
// someone else made is never overwritten silently.

import { useEffect, useState } from 'react';
import { Action, Skeleton, Status } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { useBusiness } from '../context';
import { VENUE_COPY } from '../copy/venue';
import { DaypartBar } from '../forms/DaypartBar';
import type { Daypart, Venue, Zone, ZoneSchedule } from '../types';
import { refusal, useLoad, venueMinutes } from './useVenue';

function useSchedule(zone: Zone) {
  const { client } = useBusiness();
  return useLoad<ZoneSchedule | null>(async () => (await client.schedule(zone.id)) ?? null, [client, zone.id]);
}

function TodayZone({ venue, zone }: { venue: Venue; zone: Zone }) {
  const { now } = useBusiness();
  const { data, loading } = useSchedule(zone);
  return <section className="biz-card" aria-labelledby={`today-${zone.id}`}>
    <h3 id={`today-${zone.id}`}>{zone.name}</h3>
    {loading && !data ? <Skeleton lines={1} label={VENUE_COPY.loading} /> : (
      <DaypartBar dayparts={data?.dayparts ?? []} label={VENUE_COPY.daypartsOf(zone.name)} nowMinutes={venueMinutes(now, venue.time_zone)} />
    )}
  </section>;
}

export function TodayTab({ venue }: { venue: Venue }) {
  if (!venue.zones.length) return <div className="biz-card"><p>{VENUE_COPY.noZones}</p></div>;
  return <div className="biz-stack">
    <h2>{VENUE_COPY.todayHeading}</h2>
    {venue.zones.map((zone) => <TodayZone key={zone.id} venue={venue} zone={zone} />)}
  </div>;
}

type Conflict = { who: string; at: number | null };

export function ScheduleZone({ zone, disabled }: { zone: Zone; disabled: string | null }) {
  const { client, now } = useBusiness();
  const { data, loading, reload, set } = useSchedule(zone);
  const [draft, setDraft] = useState<Daypart[] | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setDraft(data?.dayparts ?? null); }, [data]);
  const save = async () => {
    setFailed(false);
    const base: ZoneSchedule = data ?? { zone_id: zone.id, version: 0, dayparts: [] };
    try {
      const saved = await client.saveSchedule(zone.id, { ...base, dayparts: draft ?? [] });
      set(saved ?? { ...base, dayparts: draft ?? [], version: base.version + 1 });
      setConflict(null);
      showToast(VENUE_COPY.scheduleSaved(zone.name));
    } catch (error) {
      const { status, code, detail } = refusal(error);
      if (status === 409 || code === 'schedule_conflict' || code === 'version_conflict') {
        setConflict({ who: String(detail.updated_by ?? 'someone else'), at: typeof detail.updated_at === 'number' ? detail.updated_at : null });
      } else setFailed(true);
    }
  };
  return <section className="biz-card" aria-labelledby={`schedule-${zone.id}`}>
    <h3 id={`schedule-${zone.id}`}>{VENUE_COPY.scheduleOf(zone.name)}</h3>
    {loading && !data ? <Skeleton lines={2} label={VENUE_COPY.loading} /> : <>
      {!(draft ?? []).length && <p className="biz-quiet">{VENUE_COPY.noSchedule}</p>}
      <DaypartBar dayparts={draft ?? []} label={VENUE_COPY.scheduleOf(zone.name)} onChange={setDraft} disabled={disabled} />
      {conflict && <div className="biz-notice" role="alert">
        <Status kind="needs-action">{VENUE_COPY.scheduleConflict(conflict.who, conflict.at != null ? now - conflict.at : 0)}</Status>
        <p>{VENUE_COPY.scheduleConflictHelp}</p>
        <div className="biz-notice-actions"><Action run={async () => { setConflict(null); await reload(); }}>{VENUE_COPY.loadTheirs}</Action></div>
      </div>}
      {failed && <p className="warn" role="alert">{VENUE_COPY.scheduleFailed}</p>}
      <div className="biz-row">
        <Action className="primary" disabled={disabled != null} run={save} working={VENUE_COPY.savingSchedule}>{VENUE_COPY.saveSchedule}</Action>
        {disabled && <span className="biz-quiet">{disabled}</span>}
      </div>
    </>}
  </section>;
}

export function ScheduleTab({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  if (!venue.zones.length) return <div className="biz-card"><p>{VENUE_COPY.noZones}</p></div>;
  return <div className="biz-stack">
    <h2>{VENUE_COPY.scheduleOf(venue.name)}</h2>
    {venue.zones.map((zone) => <ScheduleZone key={zone.id} zone={zone} disabled={disabled} />)}
  </div>;
}
