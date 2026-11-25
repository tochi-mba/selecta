import { useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { businessOn, useBusiness } from '../context';
import { RoomSettings } from '../rooms/RoomSettings';
import { roomsClient } from '../rooms/roomsClient';
import { RequestApprovalQueue } from '../staff/RequestApprovalQueue';
import type { GuestRequest } from '../types';
import { useLoad } from './useVenue';

type Waiting = GuestRequest & { guest_id?: string };

/** Remove or ban the guest behind a waiting request (ADR-0451 abuse handling). */
function GuestTools({ zoneId, request, disabled, done }: { zoneId: string; request: Waiting; disabled: string | null; done: () => Promise<void> }) {
  const { api, org } = useBusiness();
  const rooms = useMemo(() => (api ? roomsClient(api, org.id) : null), [api, org.id]);
  if (!rooms || !request.guest_id) return null;
  const guest = request.guest_id;
  const off = disabled != null;
  return <div className="biz-row biz-quiet" aria-label={`${request.nickname} actions`}>
    <Action disabled={off} run={async () => { await rooms.remove(zoneId, guest); showToast(`${request.nickname} removed`); await done(); }}>Remove {request.nickname}</Action>
    <Action disabled={off} run={async () => { await rooms.ban(zoneId, guest, 'day'); showToast(`${request.nickname} can't ask again today`); await done(); }}>Ban for today</Action>
    <Action disabled={off} run={async () => { await rooms.ban(zoneId, guest, 'week'); showToast(`${request.nickname} can't ask again for 7 days`); await done(); }}>Ban for 7 days</Action>
  </div>;
}

export function RequestsPage({ venueId }: { venueId?: string }) {
  const { venues, client, readOnly, offline, org } = useBusiness();
  const shown = venues.filter((v) => !venueId || v.id === venueId);
  const zones = shown.flatMap((v) => v.zones);
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
    {Boolean(requests.error) && <p role="alert">Couldn't load requests. <button type="button" onClick={() => { void requests.reload(); }}>Retry</button></p>}
    {!zones.length && <p>No zones yet.</p>}
    {zones.map((zone) => {
      const waiting = (requests.data?.[zone.id] ?? []) as Waiting[];
      return <section key={zone.id} className="biz-card"><h2>{zone.name}</h2>
        <RequestApprovalQueue disabled={disabled} requests={waiting} onDecide={async (id, verdict) => {
          setError('');
          try { await client.decide(zone.id, id, verdict); }
          catch { setError("Couldn't update the request. Try again."); return false; }
        }} onDecided={requests.reload} />
        {waiting.map((request) => <GuestTools key={request.id} zoneId={zone.id} request={request} disabled={disabled} done={requests.reload} />)}
      </section>;
    })}
    {error && <p role="alert">{error}</p>}
    {venueId && shown[0] && businessOn(org.features, 'business.rooms') && <RoomSettings venue={shown[0]} disabled={disabled} />}
  </section>;
}
