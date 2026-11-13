// OpeningHoursEditor (ADR-0453 D6 step 3, D14; ADR-0444): a week grid with copy-to-days,
// overnight hours ("Fri 18:00 to 02:00 next day"), holiday closures and a plain-words preview.
// Used on S1 and S3. Changes go straight to `onChange`; the caller decides when to save.

import { useState } from 'react';
import { announce } from '../../ui/controls';
import { HOURS_COPY } from '../copy/onboarding';
import { clock, isoDayWords } from '../time';
import type { Holiday, WeekHours } from '../types';
import { copyDay, DAY_LONG, DAYS, DayKey, hoursSummary, parseClock, spanFrom, spanWords } from './hours';
import './forms.css';

export { hoursSummary } from './hours';

const DEFAULT_SPAN = { open: 600, close: 1380 };
const toInput = (minutes: number) => clock(minutes, false);

export function OpeningHoursEditor({ hours, holidays, onChange, disabled }: {
  hours: WeekHours; holidays: Holiday[]; onChange: (hours: WeekHours, holidays: Holiday[]) => void; disabled?: string | null;
}) {
  const off = Boolean(disabled);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayLabel, setHolidayLabel] = useState('');
  const [holidayError, setHolidayError] = useState('');

  const setDay = (day: DayKey, spans: WeekHours[DayKey]) => onChange({ ...hours, [day]: spans }, holidays);
  const toggle = (day: DayKey, open: boolean) => setDay(day, open ? [{ ...DEFAULT_SPAN }] : []);
  const setTime = (day: DayKey, which: 'open' | 'close', text: string) => {
    const minutes = parseClock(text);
    if (minutes == null) return;
    const span = hours[day]?.[0] ?? DEFAULT_SPAN;
    const open = which === 'open' ? minutes : span.open;
    const close = which === 'close' ? minutes : span.close % 1440;
    setDay(day, [spanFrom(open, close), ...(hours[day] ?? []).slice(1)]);
  };
  const copy = (day: DayKey, to: DayKey[]) => {
    onChange(copyDay(hours, day, to.filter((item) => item !== day)), holidays);
    announce(HOURS_COPY.copied(DAY_LONG[day]));
  };
  const addHoliday = () => {
    if (!holidayDate) { setHolidayError(HOURS_COPY.needDate); return; }
    setHolidayError('');
    const rest = holidays.filter((item) => item.date !== holidayDate);
    onChange(hours, [...rest, { date: holidayDate, closed: true, label: holidayLabel.trim() || undefined }].sort((a, b) => a.date.localeCompare(b.date)));
    setHolidayDate('');
    setHolidayLabel('');
  };

  return <div className="bzf-hours">
    <table className="bzf-hours-grid">
      <caption>{HOURS_COPY.grid}</caption>
      <thead><tr><th scope="col">{HOURS_COPY.day}</th><th scope="col">{HOURS_COPY.isOpen}</th><th scope="col">{HOURS_COPY.open}</th><th scope="col">{HOURS_COPY.close}</th><th scope="col"><span className="visually-hidden">Copy</span></th></tr></thead>
      <tbody>
        {DAYS.map((day) => {
          const span = hours[day]?.[0];
          const name = DAY_LONG[day];
          return <tr key={day} data-day={day}>
            <th scope="row">{name}</th>
            <td><label className="bzf-check"><input type="checkbox" checked={Boolean(span)} disabled={off} onChange={(event) => toggle(day, event.target.checked)} /> {span ? HOURS_COPY.isOpen : HOURS_COPY.closedDay}<span className="visually-hidden"> {name}</span></label></td>
            <td>{span && <input type="time" aria-label={`${name} ${HOURS_COPY.open}`} value={toInput(span.open)} disabled={off} onChange={(event) => setTime(day, 'open', event.target.value)} />}</td>
            <td>{span && <span className="bzf-close">
              <input type="time" aria-label={`${name} ${HOURS_COPY.close}`} value={toInput(span.close)} disabled={off} onChange={(event) => setTime(day, 'close', event.target.value)} />
              {span.close >= 1440 && <span className="biz-quiet">next day</span>}
            </span>}</td>
            <td><span className="biz-row">
              <button type="button" disabled={off} onClick={() => copy(day, DAYS)}>{HOURS_COPY.copyAll}<span className="visually-hidden"> from {name}</span></button>
              <button type="button" disabled={off} onClick={() => copy(day, DAYS.slice(0, 5))}>{HOURS_COPY.copyWeekdays}<span className="visually-hidden"> from {name}</span></button>
            </span></td>
          </tr>;
        })}
      </tbody>
    </table>

    <section className="bzf-preview" aria-labelledby="bzf-hours-preview">
      <h3 id="bzf-hours-preview">{HOURS_COPY.preview}</h3>
      <p data-testid="hours-summary">{hoursSummary(hours)}</p>
      <ul className="bzf-plain">
        {DAYS.filter((day) => hours[day]?.length).map((day) => hours[day].map((span, index) => <li key={`${day}-${index}`}>{spanWords(day, span)}</li>))}
      </ul>
    </section>

    <fieldset className="bzf-holidays" disabled={off}>
      <legend>{HOURS_COPY.holidays}</legend>
      {!holidays.length ? <p className="biz-quiet">{HOURS_COPY.holidaysEmpty}</p> : (
        <ul className="bzf-plain">
          {holidays.map((holiday) => <li key={holiday.date} className="biz-row">
            <span>{isoDayWords(holiday.date)}{holiday.label ? `, ${holiday.label}` : ''}: {HOURS_COPY.holidayClosed}</span>
            <button type="button" onClick={() => onChange(hours, holidays.filter((item) => item.date !== holiday.date))}>{HOURS_COPY.removeHoliday(isoDayWords(holiday.date))}</button>
          </li>)}
        </ul>
      )}
      <div className="biz-row bzf-holiday-add">
        <label>{HOURS_COPY.holidayDate} <input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} aria-invalid={holidayError ? true : undefined} aria-describedby={holidayError ? 'bzf-holiday-error' : undefined} /></label>
        <label>{HOURS_COPY.holidayLabel} <input type="text" value={holidayLabel} onChange={(event) => setHolidayLabel(event.target.value)} /></label>
        <button type="button" onClick={addHoliday}>{HOURS_COPY.addHoliday}</button>
      </div>
      {holidayError && <p className="warn" role="alert" id="bzf-holiday-error">{holidayError}</p>}
    </fieldset>
    {disabled && <p className="biz-quiet">{disabled}</p>}
  </div>;
}

