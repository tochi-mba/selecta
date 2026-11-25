// S3 Hours (ADR-0444): the venue's weekly opening hours, holidays and special days, public
// holiday suggestions that change nothing until added, each zone's day state, and close now with
// its 5-minute undo. Every time is the venue's own; the server decides the state.

import { useEffect, useState } from 'react';
import { Action, Problem, Skeleton } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { useBusiness } from '../context';
import { HOURS_TAB_COPY as COPY } from '../copy/hours';
import { OpeningHoursEditor } from '../forms/OpeningHoursEditor';
import { exceptionsOf, newSuggestions, weekOf, type HolidaySuggestion, type HourException, type ZoneDayState } from '../hoursAdapters';
import { isoDayWords, venueTime } from '../time';
import type { Holiday, Venue, WeekHours, Zone } from '../types';
import { useLoad } from './useVenue';

const COUNTRIES = ['GB', 'PT', 'US', 'AU'] as const;

function exceptionWords(item: HourException): string {
  const day = isoDayWords(item.date);
  const what = item.closed ? COPY.closedAllDay : COPY.specialHours(item.periods.map(([open, close]) => `${open} to ${close}`).join(', '));
  const extra = [item.until ? COPY.until(isoDayWords(item.until)) : '', item.repeat_yearly ? COPY.yearly : ''].filter(Boolean).join(', ');
  return `${day}${item.note ? ` (${item.note})` : ''}: ${what}${extra ? `, ${extra}` : ''}`;
}

function ZoneDay({ venue, zone }: { venue: Venue; zone: Zone }) {
  const { client, now } = useBusiness();
  const { data, error } = useLoad<ZoneDayState>(() => client.zoneState(zone.id), [client, zone.id, Math.floor(now / 60)]);
  if (error) return <li>{zone.name}: {COPY.loadFailed}</li>;
  if (!data) return <li>{zone.name}</li>;
  const at = (iso: string | null) => (iso ? venueTime(Date.parse(iso) / 1000, venue.time_zone) : '');
  const next = data.next_state && data.next_change ? COPY.nextChange(COPY.zoneState[data.next_state] ?? data.next_state, at(data.next_change)) : '';
  return <li data-testid={`zone-day-${zone.id}`}>
    <strong>{zone.name}</strong>: {COPY.zoneState[data.state] ?? data.state}
    {data.open_late_until && <>. {COPY.openLate(at(data.open_late_until))}</>}
    {next && <span className="biz-quiet">. {next}</span>}
  </li>;
}

function CloseNow({ venue, disabled, onChange }: { venue: Venue; disabled: string | null; onChange: () => void }) {
  const { client, now } = useBusiness();
  const [closed, setClosed] = useState<{ id: string; at: number; undoSeconds: number } | null>(null);
  const [problem, setProblem] = useState('');
  const canUndo = closed != null && now - closed.at < closed.undoSeconds;
  const message = (error: unknown) => {
    const detail = (error as { payload?: { detail?: { message?: string } } })?.payload?.detail;
    return detail?.message ?? COPY.closeFailed;
  };
  return <div className="biz-stack">
    {!canUndo ? <div className="biz-row">
      <Action disabled={disabled != null || !venue.open_now} run={async () => {
        setProblem('');
        try {
          const answer = await client.closeNow(venue.id);
          setClosed({ id: answer.id, at: now, undoSeconds: answer.undo_seconds });
          showToast(COPY.closedNow);
          onChange();
        } catch (error) { setProblem(message(error)); }
      }}>{COPY.closeNow}</Action>
      <span className="biz-quiet">{COPY.closeNowHelp}</span>
    </div> : <div className="biz-row">
      <span role="status">{COPY.closedNow}</span>
      <Action className="primary" run={async () => {
        setProblem('');
        try {
          await client.undoCloseNow(venue.id, closed.id);
          setClosed(null);
          showToast(COPY.undone);
          onChange();
        } catch (error) { setProblem(message(error)); }
      }}>{COPY.undo}</Action>
    </div>}
    {problem && <p className="warn" role="alert">{problem}</p>}
  </div>;
}

function Suggestions({ venue, exceptions, disabled, onAdded }: {
  venue: Venue; exceptions: HourException[]; disabled: string | null; onAdded: () => Promise<void>;
}) {
  const { client, now } = useBusiness();
  const thisYear = new Date(now * 1000).getUTCFullYear();
  const [country, setCountry] = useState<string>('GB');
  const [year, setYear] = useState(thisYear);
  const [found, setFound] = useState<HolidaySuggestion[] | null>(null);
  const shown = found ? newSuggestions(found, exceptions) : null;
  return <fieldset disabled={disabled != null}>
    <legend>{COPY.suggestionsHeading}</legend>
    <p className="biz-quiet">{COPY.suggestionsNote}</p>
    <div className="biz-row">
      <label htmlFor={`holiday-country-${venue.id}`}>{COPY.country}</label>
      <select id={`holiday-country-${venue.id}`} value={country} onChange={(event) => setCountry(event.target.value)}>{COUNTRIES.map((code) => <option key={code} value={code}>{code}</option>)}</select>
      <label htmlFor={`holiday-year-${venue.id}`}>{COPY.year}</label>
      <select id={`holiday-year-${venue.id}`} value={year} onChange={(event) => setYear(Number(event.target.value))}>{[thisYear, thisYear + 1].map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <Action run={async () => setFound(await client.holidaySuggestions(venue.id, country, year))}>{COPY.showSuggestions}</Action>
    </div>
    {shown && (!shown.length ? <p className="biz-quiet">{COPY.noSuggestions}</p> : <ul className="bzf-plain">
      {shown.map((item) => <li key={item.date}>
        <Action run={async () => {
          await client.addException(venue.id, { date: item.date, closed: true, label: item.note });
          showToast(COPY.added(isoDayWords(item.date)));
          await onAdded();
        }}>{COPY.addClosed(isoDayWords(item.date), item.note)}</Action>
      </li>)}
    </ul>)}
  </fieldset>;
}

function ClosingMode({ venue, mode, disabled, onSaved }: { venue: Venue; mode: 'natural' | 'exact'; disabled: string | null; onSaved: () => Promise<void> }) {
  const { client } = useBusiness();
  const [chosen, setChosen] = useState(mode);
  useEffect(() => { setChosen(mode); }, [mode]);
  const choose = async (next: 'natural' | 'exact') => {
    setChosen(next);
    await client.setClosingMode(venue.id, next);
    showToast(COPY.closingSaved);
    await onSaved();
  };
  return <fieldset disabled={disabled != null}>
    <legend>{COPY.closingHeading}</legend>
    {(['natural', 'exact'] as const).map((value) => <label key={value} className="bzf-check">
      <input type="radio" name={`closing-${venue.id}`} checked={chosen === value} onChange={() => void choose(value)} />
      {' '}{value === 'natural' ? COPY.closingNatural : COPY.closingExact}
    </label>)}
  </fieldset>;
}

export function HoursTab({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { client } = useBusiness();
  const { data, error, loading, reload } = useLoad(() => client.hours(venue.id), [client, venue.id]);
  const [week, setWeek] = useState<WeekHours | null>(null);
  const [fresh, setFresh] = useState<Holiday[]>([]);
  const [failed, setFailed] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { if (data) { setWeek(weekOf(data)); setFresh([]); } }, [data]);
  if (error && !data) return <Problem retry={reload}>{COPY.loadFailed}</Problem>;
  if (loading && !data) return <Skeleton lines={4} label={COPY.loading} />;
  const exceptions = data ? exceptionsOf(data) : [];
  const save = async () => {
    setFailed('');
    try {
      const chosen = week ?? (data ? weekOf(data) : null);
      if (chosen) await client.saveWeek(venue.id, chosen);
      for (const holiday of fresh) await client.addException(venue.id, holiday);
      showToast(COPY.saved);
      await reload();
      setTick((value) => value + 1);
    } catch (problem) {
      const detail = (problem as { payload?: { detail?: { message?: string } } })?.payload?.detail;
      setFailed(detail?.message ?? COPY.saveFailed);
    }
  };
  return <div className="biz-stack">
    <h2>{COPY.heading(venue.name)}</h2>
    <p className="biz-quiet">{COPY.timeZone(data?.time_zone ?? venue.time_zone)}</p>
    {week && <OpeningHoursEditor hours={week} holidays={fresh} disabled={disabled} onChange={(hours, holidays) => { setWeek(hours); setFresh(holidays); }} />}
    {failed && <p className="warn" role="alert">{failed}</p>}
    <div className="biz-row"><Action className="primary" disabled={disabled != null} run={save} working={COPY.saving}>{COPY.save}</Action></div>
    {data && <ClosingMode venue={venue} mode={data.closing_mode ?? 'natural'} disabled={disabled} onSaved={reload} />}
    <section className="biz-card" aria-labelledby={`exceptions-${venue.id}`}>
      <h3 id={`exceptions-${venue.id}`}>{COPY.exceptionsHeading}</h3>
      {!exceptions.length ? <p className="biz-quiet">{COPY.exceptionsEmpty}</p> : <ul className="bzf-plain">
        {exceptions.map((item) => <li key={item.id} className="biz-row" data-lift="row">
          <span>{exceptionWords(item)}</span>
          <Action disabled={disabled != null} run={async () => { await client.removeException(venue.id, item.id); await reload(); }}>{COPY.remove(isoDayWords(item.date))}</Action>
        </li>)}
      </ul>}
      <Suggestions venue={venue} exceptions={exceptions} disabled={disabled} onAdded={reload} />
    </section>
    <section className="biz-card" aria-labelledby={`zone-days-${venue.id}`}>
      <h3 id={`zone-days-${venue.id}`}>{COPY.zonesHeading}</h3>
      <ul className="bzf-plain" key={tick}>{venue.zones.map((zone) => <ZoneDay key={zone.id} venue={venue} zone={zone} />)}</ul>
      <CloseNow venue={venue} disabled={disabled} onChange={() => setTick((value) => value + 1)} />
    </section>
  </div>;
}
