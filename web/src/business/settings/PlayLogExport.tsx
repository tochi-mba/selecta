// Play-log export for licensing returns (ADR-0449 BZ-0449-06): pick a venue and the days, and
// the server answers that venue's log as CSV with totals per track. Behind `business.licensing`.

import { FormEvent, useState } from 'react';
import { DrawnTick, useMotionOn } from '../../views/feelPieces';
import { EXPORT_COPY as COPY } from '../copy/console';
import { businessOn, useBusiness } from '../context';
import { useLoad } from '../venue/useVenue';

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

/** How many songs played at a venue have an ISRC code (ADR-0449 BZ-0449-07). */
export function IsrcCoverage({ venueId }: { venueId: string }) {
  const { org, client } = useBusiness();
  const on = businessOn(org.features, 'business.licensing');
  const found = useLoad(() => (on ? client.isrcCoverage(venueId) : Promise.resolve(null)), [client, on, venueId]);
  if (!on || !found.data) return null;
  return <section className="biz-card" aria-labelledby="biz-isrc-coverage">
    <h2 id="biz-isrc-coverage">{COPY.coverageTitle}</h2>
    <p>{COPY.coverage(found.data.with_isrc, found.data.tracks)}</p>
    <p className="biz-quiet">{COPY.coverageNote}</p>
    {(org.role === 'owner' || org.role === 'admin') && <IsrcEditor venueId={venueId} onSaved={found.reload} />}
  </section>;
}

/** Enter or correct the ISRC of songs played at a venue, missing ones first (BZ-0449-07). */
function IsrcEditor({ venueId, onSaved }: { venueId: string; onSaved: () => Promise<void> }) {
  const { client } = useBusiness();
  const tracks = useLoad(() => client.isrcTracks(venueId), [client, venueId]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  // A save that lands draws a tick beside its words (ADR-0477); 0 while the last word is a problem.
  const [saved, setSaved] = useState(0);
  const moving = useMotionOn();
  const save = async (event: FormEvent, song: string, title: string) => {
    event.preventDefault();
    try {
      await client.saveIsrc(song, drafts[song] ?? '');
      setStatus(COPY.isrcSaved(title));
      setSaved((count) => count + 1);
      await tracks.reload();
      await onSaved();
    } catch (problem) {
      setStatus((problem as Error).message);
      setSaved(0);
    }
  };
  return <>
    <ul className="biz-stack">{(tracks.data?.tracks ?? []).map((track) => <li key={track.song_id}>
      <form className="biz-row" onSubmit={(event) => void save(event, track.song_id, track.title)}>
        <label className="biz-field">{COPY.isrcFor(track.title, track.artist)}
          <input value={drafts[track.song_id] ?? track.isrc ?? ''} maxLength={32} placeholder="GB-ABC-24-00012" onChange={(event) => setDrafts({ ...drafts, [track.song_id]: event.target.value })} />
        </label>
        <button type="submit">{COPY.isrcSave}</button>
      </form>
    </li>)}</ul>
    <p role="status" aria-live="polite">{moving && saved > 0 && <DrawnTick key={saved} className="biz-saved-tick" />}{status}</p>
  </>;
}
