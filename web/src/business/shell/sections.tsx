// Remaining business route screens (ADR-0453). All calls use the workspace-scoped client
// from BusinessContext, including the error, read-only and offline paths.
import { useState } from 'react';
import { Problem, Skeleton } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { BusinessDetailsForm } from '../onboarding/BusinessDetailsForm';
import { VenueForm } from '../forms/VenueForm';
import { RequestApprovalQueue } from '../staff/RequestApprovalQueue';
import { ZoneSwitcher } from '../staff/ZoneSwitcher';
import { StaffNow } from '../staff/StaffNow';
import { StaffControlDeck } from '../staff/StaffControlDeck';
import { PinKeypad } from '../staff/PinKeypad';
import { usePinGate } from '../staff/usePinGate';
import { useStaffCommands } from '../staff/useStaffCommands';
import { thisDeviceId, disabledReason, useLoad } from '../venue/useVenue';
import { ScheduleTab } from '../venue/ScheduleTabs';
import { PATHS, useBusiness } from '../context';
import type { LibrarySong, ZoneCommand } from '../client';
import type { GuestRequest, Role, Venue, Zone } from '../types';

function Failure({ message }: { message: string }) {
  return <p role="alert" className="warn">{message}</p>;
}

export function SchedulesPage() {
  const ctx = useBusiness();
  const disabled = disabledReason(ctx);
  return <section className="biz-stack"><h1>Schedules</h1>
    {!ctx.venues.length && <p>No venues yet. Create a venue before planning its music.</p>}
    {ctx.venues.map((venue) => <section key={venue.id} className="biz-stack">
      <h2>{venue.name}</h2><ScheduleTab venue={venue} disabled={disabled} />
    </section>)}
  </section>;
}

export function BillingPage() {
  const { org } = useBusiness();
  const bill = org.billing;
  const amount = (minor: number) => new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: bill.currency,
  }).format(minor / 100);
  return <section className="biz-stack"><h1>Business billing</h1>
    <p>Plan: {bill.plan}. Payment status: {bill.status.replace(/_/g, ' ')}.</p>
    {bill.grace_ends_at != null && <p>Grace period ends: {new Date(bill.grace_ends_at * 1000).toLocaleDateString()}.</p>}
    {bill.payments_available === false && <p role="status">Online billing is not available for this organisation.</p>}
    <h2>Plan items</h2>
    {!bill.lines?.length ? <p>No itemised billing information is available.</p> : <ul>
      {bill.lines.map((item, index) => <li key={index}>{item.quantity} × {item.item}: {amount(item.unit_amount)} per {item.interval}</li>)}
    </ul>}
    <h2>Invoices</h2>
    {!bill.invoices?.length ? <p>No invoices yet.</p> : <ul>
      {bill.invoices.map((invoice) => <li key={invoice.id}>
        {invoice.number} · {amount(invoice.amount)} · {invoice.status}
        {invoice.url && <a href={invoice.url} target="_blank" rel="noopener noreferrer">View invoice</a>}
      </li>)}
    </ul>}
  </section>;
}

export function PeoplePage({ venueId }: { venueId?: string }) {
  const { org, client, offline, readOnly } = useBusiness();
  const members = useLoad(() => client.members(org.id), [client, org.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [error, setError] = useState('');
  const canManage = !offline && !readOnly && (org.role === 'owner' || org.role === 'admin');
  const shown = (members.data ?? []).filter((m) => !venueId || m.venue_ids === null || m.venue_ids.includes(venueId));
  const handle = async (work: () => Promise<unknown>) => {
    setError('');
    try { await work(); await members.reload(); showToast('Team updated'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the team.'); }
  };
  return <section className="biz-stack"><h1>People and access</h1>
    {members.loading && !members.data && <Skeleton lines={3} label="Loading team" />}
    {members.error && !members.data && <Problem retry={members.reload}>Could not load the team.</Problem>}
    {error && <Failure message={error} />}
    <ul>{shown.map((member) => <li key={member.id} className="biz-row">
      <span>{member.name || member.email} · {member.role}</span>
      {canManage && <button type="button" onClick={() => void handle(() => client.removeMember(org.id, member.id))}>Remove {member.name || member.email}</button>}
    </li>)}</ul>
    {!members.loading && !shown.length && <p>No people found for this area.</p>}
    {canManage && <form onSubmit={(event) => { event.preventDefault(); if (email.trim()) void handle(async () => {
      await client.invite(org.id, { email: email.trim(), role, venue_ids: venueId ? [venueId] : null });
      setEmail('');
    }); }}>
      <h2>Invite a colleague</h2>
      <label>Email <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Role <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
        {(['staff', 'venue_manager', 'viewer', 'admin'] as Role[]).map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
      </select></label>
      <button type="submit">Send invitation</button>
    </form>}
    {!canManage && <p className="biz-quiet">Team changes require an owner or admin with an online, writable account.</p>}
  </section>;
}

type ZoneRequests = { venue: Venue; zone: Zone; requests: GuestRequest[] };
export function RequestsPage() {
  const ctx = useBusiness();
  const [error, setError] = useState('');
  const groups = useLoad<ZoneRequests[]>(async () => {
    const zones = ctx.venues.flatMap((venue) => venue.zones.map((zone) => ({ venue, zone })));
    return Promise.all(zones.map(async ({ venue, zone }) => ({
      venue, zone, requests: await ctx.client.requests(zone.id),
    })));
  }, [ctx.client, ctx.venues]);
  const decide = async (zoneId: string, id: string, verdict: 'approve' | 'pass') => {
    setError('');
    try { await ctx.client.decide(zoneId, id, verdict); await groups.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the request.'); }
  };
  const disabled = disabledReason(ctx);
  return <section className="biz-stack"><h1>Guest requests</h1>
    {groups.loading && !groups.data && <Skeleton lines={3} label="Loading requests" />}
    {groups.error && !groups.data && <Problem retry={groups.reload}>Could not load requests.</Problem>}
    {error && <Failure message={error} />}
    {(groups.data ?? []).map(({ venue, zone, requests }) => <section className="biz-stack" key={zone.id}>
      <h2>{venue.name} · {zone.name}</h2>
      <RequestApprovalQueue requests={requests} disabled={disabled}
        onDecide={(id, verdict) => decide(zone.id, id, verdict)} />
    </section>)}
    {!groups.loading && !(groups.data ?? []).length && <p>No zones are ready for requests yet.</p>}
  </section>;
}

export function StaffControl({ venueId }: { venueId: string }) {
  const ctx = useBusiness();
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const venue = ctx.venues.find((v) => v.id === venueId);
  const zone = venue?.zones.find((item) => item.id === chosen) ?? venue?.zones[0];
  const pin = usePinGate({ pinsOn: ctx.org.features['business.staff_pins'] === true,
    client: ctx.client, orgId: ctx.org.id, venueId });
  const commands = useStaffCommands({
    client: ctx.client, offline: ctx.offline, deviceId: `staff:${venueId}`, personId: pin.holder?.name ?? null,
  });
  const queue = useLoad(() => zone ? ctx.client.requests(zone.id) : Promise.resolve([] as GuestRequest[]),
    [ctx.client, zone?.id]);
  const send = async (command: ZoneCommand) => {
    if (!zone) return;
    setError('');
    try { await pin.gate(() => commands.send(zone.id, command)); await ctx.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send the command.'); }
  };
  const decide = async (id: string, verdict: 'approve' | 'pass') => {
    if (!zone) return;
    setError('');
    try { await pin.gate(() => ctx.client.decide(zone.id, id, verdict)); await queue.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the request.'); }
  };
  if (!venue || !zone) return <section className="biz-stack"><h1>Staff controls</h1><p>This venue has no available zone.</p></section>;
  const disabled = disabledReason(ctx);
  const paused = zone.state === 'paused_by_staff';
  const deviceId = thisDeviceId(ctx.org.workspace_id);
  return <section className="biz-stack">
    <h1>{venue.name} · Staff controls</h1>
    <ZoneSwitcher zones={venue.zones} current={zone.id} onChange={setChosen} />
    {error && <Failure message={error} />}
    {commands.pending > 0 && <p role="status">{commands.pending} changes will send when online.</p>}
    {commands.slow && <p role="status">Changes may take a few seconds.</p>}
    <StaffNow zone={zone} venue={venue} now={ctx.now} paused={paused}
      pausedBy={zone.paused_by ?? ''}
      onPlayHere={!disabled && deviceId ? () => send({ kind: 'play_here', device_id: deviceId }) : null} />
    {!disabled && <StaffControlDeck
      zoneName={zone.name} paused={paused} steerable={zone.paid && venue.open_now}
      onSteer={(word) => send({ kind: 'steer', word })} onSkip={() => send({ kind: 'skip' })}
      onPause={() => send({ kind: 'pause' })} onResume={() => send({ kind: 'resume' })}
      volume={zone.volume ?? 0} cap={zone.volume_cap ?? 100}
      onVolume={(level) => { void send({ kind: 'volume', level }); }}
      requests={queue.data?.length ?? 0}
      onRequests={() => { document.getElementById('staff-requests')?.scrollIntoView(); }}
    />}
    {disabled && <p className="biz-quiet">{disabled}</p>}
    <section id="staff-requests"><h2>Requests</h2>
      <RequestApprovalQueue big requests={queue.data ?? []} disabled={disabled} onDecide={decide} />
    </section>
    {pin.asking && <PinKeypad onSubmit={pin.submit} onClose={pin.cancel} />}
  </section>;
}

export function OnboardingPage() {
  const ctx = useBusiness();
  const [error, setError] = useState('');
  const disabled = disabledReason(ctx);
  const first = ctx.venues[0];
  const save = async (work: () => Promise<unknown>) => {
    setError('');
    try { await work(); await ctx.refresh(); showToast('Saved'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save setup.'); }
  };
  return <section className="biz-stack"><h1>Set up your business</h1>
    <p>Start with your organisation, then add a venue. Opening hours, zones, licensing and playback are configured in the venue pages.</p>
    {error && <Failure message={error} />}
    <BusinessDetailsForm initial={{ name: ctx.org.name, country: ctx.org.country }}
      submitLabel="Save business details" disabled={disabled}
      onSave={(body) => save(() => ctx.client.saveBusinessDetails(ctx.org.id, body))} />
    {!first ? <>
      <h2>Your first venue</h2>
      <VenueForm disabled={disabled}
        onSave={(body) => save(() => ctx.client.createVenue(ctx.org.id, body))} />
    </> : <>
      <h2>Continue setting up {first.name}</h2>
      <ul>{(['details', 'hours', 'zones', 'licence', 'rules', 'schedule'] as const).map((tab) =>
        <li key={tab}><button type="button"
          onClick={() => ctx.go(PATHS.venue(ctx.org.id, first.id, tab))}>{tab === 'rules' ? 'Music rules' : tab}</button></li>)}</ul>
    </>}
  </section>;
}

export function OrgLibrary() {
  const ctx = useBusiness();
  const songs = useLoad<LibrarySong[]>(async () => (await ctx.client.librarySongs(ctx.org.id)) ?? [],
    [ctx.client, ctx.org.id]);
  return <section className="biz-stack"><h1>Business music library</h1>
    {songs.loading && !songs.data && <Skeleton lines={4} label="Loading business songs" />}
    {songs.error && !songs.data && <Problem retry={songs.reload}>Could not load business songs.</Problem>}
    {!songs.loading && songs.data?.length === 0 && <p>This business workspace has no songs yet.</p>}
    <ul>{(songs.data ?? []).map((song) => <li key={song.id}>
      <strong>{song.title}</strong> · {song.artist} <span className="biz-quiet">({song.explicit})</span>
    </li>)}</ul>
  </section>;
}

export function SettingsPage() {
  const ctx = useBusiness();
  const [error, setError] = useState('');
  const disabled = disabledReason(ctx);
  return <section className="biz-stack"><h1>Business settings</h1>
    {error && <Failure message={error} />}
    <BusinessDetailsForm initial={{ name: ctx.org.name, country: ctx.org.country }}
      submitLabel="Save organisation settings" disabled={disabled}
      onSave={async (body) => {
        setError('');
        try {
          await ctx.client.saveBusinessDetails(ctx.org.id, body);
          await ctx.refresh();
          showToast('Organisation updated');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not save settings.');
        }
      }} />
    <p className="biz-quiet">Your role: {ctx.org.role.replace(/_/g, ' ')}.</p>
  </section>;
}
