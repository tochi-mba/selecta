import { useState } from 'react';
import { useBusiness } from '../context';
import { RequestApprovalQueue } from '../staff/RequestApprovalQueue';
import { useLoad } from './useVenue';

export function RequestsPage({ venueId }: { venueId?: string }) {
  const { venues, client, readOnly, offline } = useBusiness();
  const zones = venues.filter((v) => !venueId || v.id === venueId).flatMap((v) => v.zones);
  const keys = zones.map((zone) => zone.id).join(',');
  const requests = useLoad(async () => {
    const rows = await Promise.all(zones.map(async (zone) => [zone.id, await client.requests(zone.id)] as const));
    return Object.fromEntries(rows);
  }, [client, keys]);
  const [error, setError] = useState('');
  const disabled = readOnly ? 'This organisation is read-only' : offline ? "You're offline" : null;
  return <section className="biz biz-stack">
    <h1>Guest requests</h1>
    {requests.loading && !requests.data && <p role="status">Loading requests</p>}
    {requests.error && <p role="alert">Couldn't load requests. <button type="button" onClick={() => { void requests.reload(); }}>Retry</button></p>}
    {!zones.length && <p>No zones yet.</p>}
    {zones.map((zone) => <section key={zone.id} className="biz-card"><h2>{zone.name}</h2>
      <RequestApprovalQueue disabled={disabled} requests={requests.data?.[zone.id] ?? []} onDecide={async (id, verdict) => {
        setError('');
        try { await client.decide(zone.id, id, verdict); await requests.reload(); }
        catch { setError("Couldn't update the request. Try again."); }
      }} />
    </section>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
