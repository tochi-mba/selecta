// Play-log export for licensing returns (ADR-0449 BZ-0449-06): pick a venue and the days, and
// the server answers that venue's log as CSV with totals per track. Behind `business.licensing`.

import { FormEvent, useState } from 'react';
import { EXPORT_COPY as COPY } from '../copy/console';
import { businessOn, useBusiness } from '../context';

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `venueId`: the export for one venue (its Play log tab), without a venue choice. */
export function PlayLogExport({ venueId }: { venueId?: string } = {}) {
  const { org, venues, client } = useBusiness();
  const [venue, setVenue] = useState(venueId ?? venues[0]?.id ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  if (!businessOn(org.features, 'business.licensing') || !venues.length) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!venue) { setStatus(COPY.needVenue); return; }
    if (!from || !to) { setStatus(COPY.needDates); return; }
    if (to < from) { setStatus(COPY.backwards); return; }
    setBusy(true);
    setStatus(COPY.starting);
    try {
      const file = await client.exportPlayLog(venue, from, to);
      saveFile(file.filename, file.csv);
      setStatus(COPY.ready(file.filename));
    } catch (problem) {
      setStatus((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <form className="biz-card" onSubmit={submit} aria-labelledby="biz-playlog-export">
    <h2 id="biz-playlog-export">{COPY.title}</h2>
    <p>{COPY.intro}</p>
    {!venueId && <label className="biz-field">{COPY.venue}
      <select value={venue} onChange={(event) => setVenue(event.target.value)}>
        {venues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    <div className="biz-row">
      <label className="biz-field">{COPY.from}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="biz-field">{COPY.to}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <p className="biz-quiet">{COPY.datesNote} {COPY.csvNote}</p>
    <div className="biz-row"><button type="submit" disabled={busy}>{busy ? COPY.starting : COPY.start}</button></div>
    <p role="status" aria-live="polite">{status}</p>
  </form>;
}
