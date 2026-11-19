// Plan changes on the billing page (ADR-0447 BZ-0447-10, -11): pay for fewer venues (the owner
// picks which stay; the rest pause at their close, nothing is deleted), bring a paused venue
// back, and move a venue to another organisation with both owners' consent.

import { FormEvent, useState } from 'react';
import { BILLING_COPY as COPY } from '../copy/console';
import { useBusiness } from '../context';
import { dayWords } from '../time';
import type { BillingSummary, VenueTransfer } from '../types';
import { useLoad } from '../venue/useVenue';

export function DowngradeCard({ summary, onChanged }: { summary: BillingSummary; onChanged: () => Promise<void> }) {
  const { client } = useBusiness();
  const live = summary.venues.filter((venue) => (venue.state ?? 'active') === 'active');
  const away = summary.venues.filter((venue) => venue.state === 'pausing' || venue.state === 'paused');
  const [keep, setKeep] = useState<string[]>(() => live.map((venue) => venue.venue_id));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try { setStatus(await work()); await onChanged(); } catch (problem) { setStatus((problem as Error).message); } finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!keep.length) { setStatus(COPY.keepOne); return; }
    void run(async () => COPY.downgraded((await client.downgrade(keep)).pausing.length));
  };
  if (!live.length && !away.length) return null;
  return <section className="biz-card" aria-labelledby="biz-billing-downgrade">
    <h2 id="biz-billing-downgrade">{COPY.downgradeTitle}</h2>
    {away.map((venue) => <div key={venue.venue_id} className="biz-row">
      <p>{venue.state === 'paused' ? COPY.venuePaused(venue.name) : COPY.venuePausing(venue.name, venue.pause_at ? dayWords(venue.pause_at) : '')}</p>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await client.resumeVenue(venue.venue_id); return COPY.resumed(venue.name); })}>{COPY.resumeVenue(venue.name)}</button>
    </div>)}
    {live.length > 1 && <form onSubmit={submit}>
      <p className="biz-quiet">{COPY.downgradeIntro}</p>
      {live.map((venue) => <label key={venue.venue_id}><input type="checkbox" checked={keep.includes(venue.venue_id)}
        onChange={(event) => setKeep(event.target.checked ? [...keep, venue.venue_id] : keep.filter((id) => id !== venue.venue_id))} />{COPY.keepVenue(venue.name)}</label>)}
      <div className="biz-row"><button type="submit" disabled={busy || keep.length === live.length}>{COPY.downgradeButton}</button></div>
    </form>}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}

export function TransferCard({ summary }: { summary: BillingSummary }) {
  const { client } = useBusiness();
  const list = useLoad(() => client.transfers(), [client]);
  const [venue, setVenue] = useState(summary.venues[0]?.venue_id ?? '');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const names = new Map(summary.venues.map((item) => [item.venue_id, item.name]));
  const mine = list.data?.organisation_id ?? summary.organisation_id ?? '';
  const run = async (work: () => Promise<unknown>, done = '') => {
    setBusy(true);
    try { await work(); setStatus(done); await list.reload(); } catch (problem) { setStatus((problem as Error).message); } finally { setBusy(false); }
  };
  const line = (transfer: VenueTransfer) => transfer.source_organisation_id === mine
    ? COPY.transferOut(names.get(transfer.venue_id) ?? transfer.venue_id)
    : COPY.transferIn(transfer.source_organisation_id);
  return <section className="biz-card" aria-labelledby="biz-billing-transfer">
    <h2 id="biz-billing-transfer">{COPY.transferTitle}</h2>
    <p className="biz-quiet">{COPY.transferIntro}</p>
    {mine && <p>{COPY.yourId(mine)}</p>}
    {Boolean(list.data?.transfers.length) && <ul aria-label={COPY.transfersCaption}>{list.data!.transfers.map((transfer) => <li key={transfer.id}>
      {line(transfer)}{transfer.effective_at ? `. ${COPY.transferWhen(dayWords(transfer.effective_at))}` : ''}{' '}
      {transfer.target_organisation_id === mine && transfer.state === 'proposed' && <button type="button" disabled={busy} onClick={() => void run(() => client.answerTransfer(transfer.id, 'accept'))}>{COPY.acceptTransfer}</button>}
      <button type="button" disabled={busy} onClick={() => void run(() => client.answerTransfer(transfer.id, 'cancel'))}>{COPY.cancelTransfer}</button>
    </li>)}</ul>}
    {summary.venues.length > 0 && <form className="biz-row" onSubmit={(event) => { event.preventDefault(); void run(() => client.proposeTransfer(venue, target.trim()), COPY.transferAsked); }}>
      <label className="biz-field">{COPY.transferVenue}
        <select value={venue} onChange={(event) => setVenue(event.target.value)}>{summary.venues.map((item) => <option key={item.venue_id} value={item.venue_id}>{item.name}</option>)}</select>
      </label>
      <label className="biz-field">{COPY.targetOrg}<input value={target} required maxLength={64} onChange={(event) => setTarget(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{COPY.transferButton}</button>
    </form>}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
