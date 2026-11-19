// Rooms for Business settings under a venue's Requests tab (ADR-0451): each zone's standing room
// (requests on or off, who approves, limits inside their ranges, pause and resume), its table-card
// code with rotation, the venue's look on the guest page, the on-screen code and the print sheet.
// Branding, print and screen code each show only while their flag is on, and the page reflows.

import { useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import { businessOn, useBusiness } from '../context';
import type { Venue, Zone } from '../types';
import { useLoad } from '../venue/useVenue';
import { openPrintSheet } from './printSheet';
import { roomsClient, type RoomLimits, type RoomMode, type RoomsClient, type RoomView } from './roomsClient';

const MODES: { value: RoomMode; label: string }[] = [
  { value: 'staff_approve', label: 'Staff approve each request' },
  { value: 'auto_accept', label: 'Accept requests that fit' },
  { value: 'off', label: 'Off (guests can watch only)' },
];
const LIMIT_WORDS: Record<keyof RoomLimits, string> = {
  pending_per_guest: 'Waiting requests per guest',
  per_guest_per_hour: 'Requests per guest per hour',
  song_cooldown_min: 'Minutes before a played song can be asked for again',
  pending_in_zone: 'Waiting requests in the zone',
  accepted_per_hour: 'Accepted requests per hour',
  guests_at_once: 'Guests in the zone at once',
  expiry_min: 'Minutes before an unanswered request expires',
};

function words(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { detail?: { message?: string } } })?.payload;
  return payload?.detail?.message ?? fallback;
}

function Limits({ view, onSave, off }: { view: RoomView; onSave: (limits: Partial<RoomLimits>) => Promise<void>; off: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(view.limits).map(([k, v]) => [k, String(v)])));
  const keys = Object.keys(LIMIT_WORDS) as (keyof RoomLimits)[];
  const errorOf = (key: keyof RoomLimits) => {
    const [low, high] = view.limit_ranges[key] ?? [0, 0];
    const value = Number(draft[key]);
    return Number.isInteger(value) && value >= low && value <= high ? undefined : `From ${low} to ${high}`;
  };
  const bad = keys.some((key) => errorOf(key));
  return <fieldset className="venue-fields" disabled={off}>
    <legend>Limits</legend>
    {keys.map((key) => <TextField key={key} type="number" label={LIMIT_WORDS[key]} value={draft[key] ?? ''} error={errorOf(key)} disabled={off}
      onChange={(text) => setDraft({ ...draft, [key]: text })} />)}
    <Action disabled={off || bad} run={() => onSave(Object.fromEntries(keys.map((key) => [key, Number(draft[key])])) as Partial<RoomLimits>)}>Save limits</Action>
  </fieldset>;
}

function ZoneRoom({ zone, rooms, disabled }: { zone: Zone; rooms: RoomsClient; disabled: string | null }) {
  const { org } = useBusiness();
  const room = useLoad(() => rooms.room(zone.id), [rooms, zone.id]);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [screen, setScreen] = useState<string | null>(null);
  const off = disabled != null;
  const change = async (body: Parameters<RoomsClient['change']>[1], done?: string) => {
    setError('');
    try { room.set(await rooms.change(zone.id, body)); if (done) showToast(done); }
    catch (problem) { setError(words(problem, "That setting couldn't be saved. Try again.")); }
  };
  if (room.error && !room.data) return <p role="alert">Couldn't read the {zone.name} room. <button type="button" onClick={() => { void room.reload(); }}>Retry</button></p>;
  if (!room.data) return <p role="status">Reading the {zone.name} room</p>;
  const view = room.data;
  return <section className="biz-stack" aria-label={`${zone.name} requests`}>
    <h3>{zone.name}</h3>
    {view.flood_switched && <p className="warn" role="status">Lots of requests arrived at once, so {zone.name} switched to staff approval. Pick a mode to change it.</p>}
    <label className="venue-check"><input type="checkbox" checked={view.requests_on} disabled={off} onChange={(event) => void change({ requests_on: event.target.checked })} /><span>Take guest requests in {zone.name}</span></label>
    <Select label="Who approves" value={view.mode} disabled={off} options={MODES} onChange={(mode) => void change({ mode }, 'Saved')} />
    <div className="biz-row">
      {view.paused
        ? <Action disabled={off} run={async () => { await rooms.resume(zone.id); await room.reload(); showToast(`Requests resumed in ${zone.name}`); }}>Resume requests</Action>
        : <Action disabled={off} run={async () => { await rooms.pause(zone.id); await room.reload(); showToast(`Requests paused in ${zone.name}`); }}>Pause requests</Action>}
    </div>
    <Limits key={JSON.stringify(view.limits)} view={view} off={off} onSave={(limits) => change({ limits }, 'Limits saved')} />
    <p>Table card code: <strong>{view.code}</strong></p>
    {!rotating ? <Action disabled={off} run={() => setRotating(true)}>Make a new code</Action> : <div className="biz-stack" role="alertdialog" aria-label="Make a new code">
      <p className="warn">Printed table cards and posters with the old code stop working. Guests already in keep their place.</p>
      <div className="biz-row">
        <Action disabled={off} run={async () => {
          const done = await rooms.rotate(zone.id);
          setRotating(false); await room.reload();
          showToast(done.warning);
        }}>Make the new code</Action>
        <button type="button" onClick={() => setRotating(false)}>Keep the old code</button>
      </div>
    </div>}
    {businessOn(org.features, 'business.rooms.branding') && <fieldset className="venue-fields" disabled={off}>
      <legend>How the guest page looks</legend>
      <TextField label="Welcome line (up to 140 characters)" value={welcome ?? view.welcome ?? ''} disabled={off} onChange={(text) => setWelcome(text.slice(0, 140))} />
      <TextField label="Accent colour (#RRGGBB)" value={accent ?? view.accent ?? ''} disabled={off} onChange={setAccent} help={view.accent_reason ?? undefined} />
      <TextField type="url" label="Logo link (https)" value={logo ?? view.logo_url ?? ''} disabled={off} onChange={setLogo} />
      <Action disabled={off} run={() => change({
        ...(welcome !== null ? { welcome } : {}), ...(accent !== null ? { accent: accent || null } : {}), ...(logo !== null ? { logo_url: logo || null } : {}),
      }, 'Guest page saved')}>Save guest page</Action>
    </fieldset>}
    {businessOn(org.features, 'business.rooms.screen_code') && <fieldset className="venue-fields" disabled={off}>
      <legend>Code on the screen</legend>
      <label className="venue-check"><input type="checkbox" checked={!!view.screen_code_on} disabled={off} onChange={(event) => void change({ screen_code_on: event.target.checked })} />
        <span>Guests need the code shown on the zone's screen (it changes every 15 minutes). Printed cards then only show what's playing.</span></label>
      {view.screen_code_on && <div className="biz-row">
        <Action disabled={off} run={async () => setScreen((await rooms.screenCode(zone.id)).code)}>Show the code now</Action>
        {screen && <p className="biz-screen-code" aria-live="polite"><strong>{screen}</strong></p>}
      </div>}
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function RoomSettings({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { api, org } = useBusiness();
  const rooms = useMemo(() => (api ? roomsClient(api, org.id) : null), [api, org.id]);
  const [error, setError] = useState('');
  if (!rooms || !businessOn(org.features, 'business.rooms')) return null;
  return <div className="biz-card biz-stack">
    <h2>Guest request rooms</h2>
    {businessOn(org.features, 'business.rooms.print') && <div className="biz-row">
      <Action disabled={disabled != null} run={async () => {
        setError('');
        try { if (!openPrintSheet(await rooms.print(venue.id))) setError('Your browser blocked the print window. Allow pop-ups for SelectaDJ and try again.'); }
        catch (problem) { setError(words(problem, "The print sheet couldn't be made. Try again.")); }
      }}>Print table cards and posters</Action>
    </div>}
    {venue.zones.map((zone) => <ZoneRoom key={zone.id} zone={zone} rooms={rooms} disabled={disabled} />)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
