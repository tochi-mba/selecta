import { useEffect, useState } from 'react';
import { businessOn, useBusiness } from '../context';
import type { GuestRequest } from '../types';
import { ManagerNotice } from '../components/Notices';
import { STAFF_COPY, handBackOffer, playHereQuestion, stayLateWords, stayingLateWords } from '../copy/staff';
import { useZoneSpeaker } from '../../devices/useZoneSpeaker';
import type { Api } from '../../cloud/api';
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
  const { org, venues, client, offline, readOnly, now, refresh, loading, api } = useBusiness();
  const venue = venues.find((v) => v.id === venueId);
  const [zoneId, setZoneId] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [error, setError] = useState('');
  const pinsOn = businessOn(org.features, 'business.devices.shared');
  const gate = usePinGate({ pinsOn, client, orgId: org.id, venueId });
  const pairedDevice = thisDeviceId(org.workspace_id);
  const commands = useStaffCommands({ client, offline, deviceId: pairedDevice ?? 'staff-browser', personId: null });
  const zone = venue?.zones.find((z) => z.id === zoneId) ?? venue?.zones[0];
  // Play here (ADR-0443): this browser becomes the zone's speaker, fenced, with heartbeats.
  const speaker = useZoneSpeaker({ api: api ?? noApi, workspaceId: org.workspace_id, zoneId: zone?.id ?? '', zoneName: zone?.name ?? '' });
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
  // Play here is offered when the zone is silent and this browser can reach the zone routes; the
  // server asks first (confirm_needed) when a kiosk is still playing.
  const speaking = speaker.phase === 'speaking' || speaker.phase === 'starting';
  const playHere = !disabled && !offline && api && !speaking && (speaker.deviceId() === null || zone.speaker_device_id !== speaker.deviceId())
    ? async () => { if ((await speaker.playHere(false)) === 'speaking') await refresh(); } : null;
  const confirmPlayHere = async () => { if ((await speaker.playHere(true)) === 'speaking') await refresh(); };
  return <section className="biz biz-stack"><h1>Staff controls: {venue.name}</h1>
    <ZoneSwitcher zones={venue.zones} current={zone.id} onChange={setZoneId} />
    <StaffNow zone={zone} venue={venue} now={now} paused={zone.state === 'paused_by_staff'} pausedBy={zone.paused_by ?? ''} onPlayHere={playHere} />
    {speaker.phase === 'confirm' && <section className="biz-staff-card" aria-label={STAFF_COPY.playHere}>
      <p>{playHereQuestion(zone.name)}</p>
      <div className="biz-row">
        <BigAction run={confirmPlayHere}>{STAFF_COPY.playHereConfirm}</BigAction>
        <BigAction run={async () => speaker.cancel()}>{STAFF_COPY.cancel}</BigAction>
      </div>
    </section>}
    {speaker.phase === 'speaking' && <section className="biz-staff-card" aria-label={STAFF_COPY.playingHere}>
      <p role="status">{speaker.message}</p>
      <p>{speaker.handBackOffered ? handBackOffer(zone.name) : STAFF_COPY.keepPlayingHere}</p>
      <BigAction run={async () => { await speaker.handBack(); await refresh(); }}>{STAFF_COPY.handBack}</BigAction>
    </section>}
    {speaker.phase === 'idle' && speaker.message && <p role="status">{speaker.message}</p>}
    {speaker.error && <p role="alert">{speaker.error}</p>}
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

/** Without the signed-in Api (a harness), Play here is not offered; this never runs. */
const noApi: Api = async () => { throw new Error('No connection to SelectaDJ'); };
