// Usage (ADR-0448 BZ-0448-08, BZ-0448-09): the organisation's allowances as the server enforces
// them, by venue, and this month's playback continuity per zone with any service credits. Owners,
// admins and venue managers only; the server refuses everyone else, and the page says so.

import { useState } from 'react';
import { Action, Problem, Skeleton } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { useBusiness } from '../context';
import { USAGE_COPY as COPY } from '../copy/hours';
import { gigabytes, meterWords, percentWords, type SloAnswer, type UsageAnswer } from '../hoursAdapters';
import { dayWords } from '../time';
import { refusal, useLoad } from '../venue/useVenue';

function MeterRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><dt>{label}</dt><dd>{value}{note && <span className="biz-quiet"> {note}</span>}</dd></div>;
}

function Meters({ usage }: { usage: UsageAnswer }) {
  return <section className="biz-card" aria-labelledby="usage-meters">
    <h2 id="usage-meters">{COPY.heading}</h2>
    {usage.storage.read_only && <p className="warn" role="alert">{usage.storage.message || COPY.readOnly}</p>}
    <dl className="venue-facts">
      <MeterRow label={COPY.storage} value={meterWords(usage.storage, gigabytes)} note={COPY.storageNote} />
      <MeterRow label={COPY.derived} value={meterWords(usage.derived, gigabytes)} />
      <MeterRow label={COPY.seats} value={meterWords(usage.seats)} note={COPY.seatsNote} />
      <MeterRow label={COPY.zones} value={meterWords(usage.zones)} />
      <MeterRow label={COPY.analysis} value={meterWords(usage.analysis)} note={COPY.resets(dayWords(usage.analysis.resets_at))} />
      {Object.entries(usage.lucy).map(([key, pool]) => <MeterRow key={key} label={`${COPY.lucy}: ${COPY.lucyClass[key] ?? key}`} value={meterWords(pool)} note={COPY.resets(dayWords(pool.resets_at))} />)}
    </dl>
  </section>;
}

function Venues({ usage }: { usage: UsageAnswer }) {
  return <section className="biz-card" aria-labelledby="usage-venues">
    <h2 id="usage-venues">{COPY.venuesHeading}</h2>
    <table className="biz-table">
      <thead><tr><th scope="col">{COPY.venue}</th><th scope="col">{COPY.venueStorage}</th><th scope="col">{COPY.venueZones}</th><th scope="col">{COPY.venueRender}</th></tr></thead>
      <tbody>{usage.venues.map((venue) => <tr key={venue.venue_id}>
        <th scope="row">{venue.name}{!venue.entitled && <span className="biz-quiet"> ({COPY.paused})</span>}{venue.pilot && <span className="biz-quiet"> ({COPY.pilot})</span>}</th>
        <td>{gigabytes(venue.storage_bytes)}</td>
        <td>{meterWords(venue.zones)}</td>
        <td>{venue.render.length ? venue.render.map((row) => `${Math.round(row.cpu_used_s / 60)} of ${Math.round(row.cpu_budget_s / 60)} CPU minutes`).join(', ') : COPY.noRender}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

function Continuity({ slo }: { slo: SloAnswer }) {
  return <section className="biz-card" aria-labelledby="usage-continuity">
    <h2 id="usage-continuity">{COPY.continuityHeading}</h2>
    <p>{COPY.continuityIntro(percentWords(slo.targets.continuity))}</p>
    {!slo.zones.length ? <p className="biz-quiet">{COPY.noMonths}</p> : <table className="biz-table">
      <thead><tr><th scope="col">{COPY.venue}</th><th scope="col">{COPY.zone}</th><th scope="col">{COPY.continuity}</th><th scope="col">{COPY.readiness}</th><th scope="col">{COPY.unknown}</th></tr></thead>
      <tbody>{slo.zones.map((row) => <tr key={row.zone_id}>
        <td>{row.venue_name}</td><td>{row.zone_id}</td>
        <td>{percentWords(row.continuity)}</td><td>{percentWords(row.readiness)}</td><td>{row.unknown_minutes}</td>
      </tr>)}</tbody>
    </table>}
    <p className="biz-quiet">{COPY.unknownNote}</p>
    <h3>{COPY.creditsHeading}</h3>
    <p className="biz-quiet">{COPY.creditsNote}</p>
    {slo.credits.length > 0 && <ul className="bzf-plain">{slo.credits.map((credit) => <li key={credit.id}>{credit.month}, {credit.venue_id}: {COPY.credit(credit.percent, credit.state)}</li>)}</ul>}
  </section>;
}

function AlwaysOpen({ confirmed }: { confirmed: boolean }) {
  const { client, org } = useBusiness();
  const [value, setValue] = useState(confirmed);
  if (org.role !== 'owner' && org.role !== 'admin') return null;
  return <section className="biz-card" aria-labelledby="usage-always-open">
    <h2 id="usage-always-open">{COPY.alwaysOpenHeading}</h2>
    <p className="biz-quiet">{COPY.alwaysOpenNote}</p>
    <label className="bzf-check"><input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} /> {COPY.alwaysOpenConfirm}</label>
    <div className="biz-row"><Action run={async () => { await client.setAlwaysOpen(value); showToast(COPY.alwaysOpenSaved); }}>{COPY.alwaysOpenSave}</Action></div>
  </section>;
}

export function UsagePage() {
  const { client } = useBusiness();
  const usage = useLoad(() => client.usage(), [client]);
  const slo = useLoad(() => client.slo(), [client]);
  if (usage.error && !usage.data) {
    const { status } = refusal(usage.error);
    return <section className="biz-stack"><h1>{COPY.heading}</h1><Problem retry={status === 403 ? undefined : usage.reload}>{status === 403 ? COPY.notAllowed : COPY.loadFailed}</Problem></section>;
  }
  return <section className="biz-stack">
    <h1>{COPY.heading}</h1>
    <p className="biz-quiet">{COPY.intro}</p>
    {!usage.data ? <Skeleton lines={4} label={COPY.loading} /> : <>
      <Meters usage={usage.data} />
      <Venues usage={usage.data} />
      <AlwaysOpen confirmed={Boolean(usage.data.always_open_confirmed)} />
    </>}
    {slo.data && <Continuity slo={slo.data} />}
  </section>;
}
