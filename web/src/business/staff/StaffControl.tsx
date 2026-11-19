import { useEffect, useState } from 'react';
import { businessOn, useBusiness } from '../context';
import type { GuestRequest } from '../types';
import { ManagerNotice } from '../components/Notices';
import { STAFF_COPY, playHereQuestion, stayLateWords, stayingLateWords } from '../copy/staff';
import { venueTime } from '../time';
import { BigAction } from './BigAction';
import { staffManagerLine, viewerIsManager } from './managerLine';
import { RequestApprovalQueue } from './RequestApprovalQueue';
import { DeckSkeleton, StaffControlDeck, type StayLate } from './StaffControlDeck';
import { NowSkeleton, StaffNow } from './StaffNow';
import { PinKeypad } from './PinKeypad';
import { ZoneSwitcher } from './ZoneSwitcher';
import { usePinGate } from './usePinGate';
import { useStaffCommands } from './useStaffCommands';
import { thisDeviceId } from '../venue/useVenue';

export function StaffControl({ venueId }: { venueId: string }) {
  const { org, venues, client, offline, readOnly, now, refresh, loading } = useBusiness();
  const venue = venues.find((v) => v.id === venueId);
  const [zoneId, setZoneId] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [error, setError] = useState('');
  const [askPlayHere, setAskPlayHere] = useState(false);
  const pinsOn = businessOn(org.features, 'business.staff_pins');
  const gate = usePinGate({ pinsOn, client, orgId: org.id, venueId });
  const pairedDevice = thisDeviceId(org.workspace_id);
  const commands = useStaffCommands({ client, offline, deviceId: pairedDevice ?? 'staff-browser', personId: null });
  const zone = venue?.zones.find((z) => z.id === zoneId) ?? venue?.zones[0];
  useEffect(() => {
    if (!zone) return;
    let live = true;
    client.requests(zone.id).then((items) => { if (live) setRequests(items); })
      .catch(() => { if (live) setError("Couldn't load guest requests"); });
    return () => { live = false; };
  }, [client, zone?.id, now]);
  if (!venue && loading) return <section className="biz biz-stack"><h1>Staff controls</h1><NowSkeleton /><DeckSkeleton /></section>;
  if (!venue) return <section className="biz"><h1>Staff controls</h1><p>This venue is unavailable.</p></section>;
  if (!zone) return <section className="biz"><h1>{venue.name}</h1><p>No zones are configured.</p></section>;
  const disabled = readOnly;
  const send = (kind: 'skip' | 'pause' | 'resume') => () => gate.gate(() => commands.send(zone.id, { kind })).then(() => refresh());
  const steer = (word: 'bigger' | 'calmer' | 'something_else') => gate.gate(() => commands.send(zone.id, { kind: 'steer', word })).then(() => refresh());
  const decide = async (id: string, verdict: 'approve' | 'pass') => {
    await gate.gate(() => client.decide(zone.id, id, verdict));
    setRequests(await client.requests(zone.id));
  };
  const managerLine = staffManagerLine({ org, venue, now, manager: viewerIsManager(org, pinsOn, gate.holder?.role) });
  const late = venue.stay_open_late;
  const stayLate: StayLate | null = !late || late.allowance_minutes <= 0 ? null
    : late.until && late.until > now ? { kind: 'on', words: stayingLateWords(venueTime(late.until, venue.time_zone)) }
    : venue.open_now && venue.next_close_at ? {
      kind: 'offer', words: stayLateWords(venueTime(venue.next_close_at + late.allowance_minutes * 60, venue.time_zone)),
      run: () => gate.gate(() => client.stayOpenLate(org.id, venue.id, late.allowance_minutes)).then(() => refresh()),
    } : null;
  // Play here: only a paired tablet can stand in as the zone's speaker (ADR-0443), never the one already playing.
  const playHere = !disabled && pairedDevice && zone.speaker_device_id !== pairedDevice ? async () => { setAskPlayHere(true); } : null;
  const confirmPlayHere = () => gate.gate(() => commands.send(zone.id, { kind: 'play_here', device_id: pairedDevice ?? '' }))
    .then(() => { setAskPlayHere(false); return refresh(); });
  return <section className="biz biz-stack"><h1>Staff controls: {venue.name}</h1>
    <ZoneSwitcher zones={venue.zones} current={zone.id} onChange={setZoneId} />
    <StaffNow zone={zone} venue={venue} now={now} paused={zone.state === 'paused_by_staff'} pausedBy={zone.paused_by ?? ''} onPlayHere={playHere} />
    {askPlayHere && <section className="biz-staff-card" aria-label={STAFF_COPY.playHere}>
      <p>{playHereQuestion(zone.name)}</p>
      <div className="biz-row">
        <BigAction run={confirmPlayHere}>{STAFF_COPY.playHereConfirm}</BigAction>
        <BigAction run={async () => setAskPlayHere(false)}>{STAFF_COPY.cancel}</BigAction>
      </div>
    </section>}
    {disabled ? <p role="status">This organisation is read-only. Controls are unavailable.</p> :
      <StaffControlDeck zoneName={zone.name} paused={zone.state === 'paused_by_staff'}
        steerable={zone.paid && (zone.state === 'playing' || zone.state === 'playing_saved')}
        onSteer={steer} onSkip={send('skip')} onPause={send('pause')} onResume={send('resume')}
        volume={zone.volume ?? 0} cap={zone.volume_cap ?? 100}
        onVolume={(level) => { void gate.gate(() => commands.send(zone.id, { kind: 'volume', level })); }}
        requests={requests.length} onRequests={() => setShowRequests((value) => !value)} stayLate={stayLate} />}
    {commands.pending > 0 && <p role="status">{commands.pending} change(s) will send when back online.</p>}
    {commands.slow && <p role="status">Changes may take a few seconds to reach the players.</p>}
    {showRequests && <RequestApprovalQueue requests={requests} big disabled={disabled ? 'Read-only' : null} onDecide={decide} />}
    {error && <p role="alert">{error}</p>}
    {managerLine && <ManagerNotice line kind="warning">{managerLine}</ManagerNotice>}
    {gate.asking && <PinKeypad onSubmit={gate.submit} onClose={gate.cancel} />}
  </section>;
}
