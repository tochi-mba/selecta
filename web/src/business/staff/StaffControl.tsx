import { useEffect, useState } from 'react';
import { businessOn, useBusiness } from '../context';
import type { GuestRequest } from '../types';
import { RequestApprovalQueue } from './RequestApprovalQueue';
import { StaffControlDeck } from './StaffControlDeck';
import { StaffNow } from './StaffNow';
import { PinKeypad } from './PinKeypad';
import { ZoneSwitcher } from './ZoneSwitcher';
import { usePinGate } from './usePinGate';
import { useStaffCommands } from './useStaffCommands';
import { thisDeviceId } from '../venue/useVenue';
import { StaffSpeakerLine } from '../localFirst/ReadinessPanel';

export function StaffControl({ venueId }: { venueId: string }) {
  const { org, venues, client, offline, readOnly, now, refresh } = useBusiness();
  const venue = venues.find((v) => v.id === venueId);
  const [zoneId, setZoneId] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [error, setError] = useState('');
  const gate = usePinGate({ pinsOn: businessOn(org.features, 'business.staff_pins'), client, orgId: org.id, venueId });
  const commands = useStaffCommands({ client, offline, deviceId: thisDeviceId(org.workspace_id) ?? 'staff-browser', personId: null });
  const zone = venue?.zones.find((z) => z.id === zoneId) ?? venue?.zones[0];
  useEffect(() => {
    if (!zone) return;
    let live = true;
    client.requests(zone.id).then((items) => { if (live) setRequests(items); })
      .catch(() => { if (live) setError("Couldn't load guest requests"); });
    return () => { live = false; };
  }, [client, zone?.id, now]);
  if (!venue) return <section className="biz"><h1>Staff controls</h1><p>This venue is unavailable.</p></section>;
  if (!zone) return <section className="biz"><h1>{venue.name}</h1><p>No zones are configured.</p></section>;
  const disabled = readOnly;
  const send = (kind: 'skip' | 'pause' | 'resume') => () => gate.gate(() => commands.send(zone.id, { kind })).then(() => refresh());
  const steer = (word: 'bigger' | 'calmer' | 'something_else') => gate.gate(() => commands.send(zone.id, { kind: 'steer', word })).then(() => refresh());
  const decide = async (id: string, verdict: 'approve' | 'pass') => {
    await gate.gate(() => client.decide(zone.id, id, verdict));
    setRequests(await client.requests(zone.id));
  };
  return <section className="biz biz-stack"><h1>Staff controls: {venue.name}</h1>
    <ZoneSwitcher zones={venue.zones} current={zone.id} onChange={setZoneId} />
    <StaffNow zone={zone} venue={venue} now={now} paused={zone.state === 'paused_by_staff'} pausedBy={zone.paused_by ?? ''} />
    {businessOn(org.features, 'business.local_first') && <StaffSpeakerLine zone={zone} venue={venue} now={now} offline={offline} />}
    {disabled ? <p role="status">This organisation is read-only. Controls are unavailable.</p> :
      <StaffControlDeck zoneName={zone.name} paused={zone.state === 'paused_by_staff'}
        steerable={zone.paid && (zone.state === 'playing' || zone.state === 'playing_saved')}
        onSteer={steer} onSkip={send('skip')} onPause={send('pause')} onResume={send('resume')}
        volume={zone.volume ?? 0} cap={zone.volume_cap ?? 100}
        onVolume={(level) => { void gate.gate(() => commands.send(zone.id, { kind: 'volume', level })); }}
        requests={requests.length} onRequests={() => setShowRequests((value) => !value)} />}
    {commands.pending > 0 && <p role="status">{commands.pending} change(s) will send when back online.</p>}
    {commands.slow && <p role="status">Changes may take a few seconds to reach the players.</p>}
    {showRequests && <RequestApprovalQueue requests={requests} big disabled={disabled ? 'Read-only' : null} onDecide={decide} />}
    {error && <p role="alert">{error}</p>}
    {gate.asking && <PinKeypad onSubmit={gate.submit} onClose={gate.cancel} />}
  </section>;
}
