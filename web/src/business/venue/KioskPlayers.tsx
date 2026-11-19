// The venue's kiosk players (ADR-0445): each player with its zone, home or standby, online or
// "Not seen since", what its last health report says (saved music, wake lock, autoplay), and
// Unpair or Replace. Pairing a new player is the PairingCodeEntry step. All of it sits behind
// `business.kiosk`; with the flag off the Devices tab shows the shared tablets only.

import { useCallback, useEffect, useState } from 'react';
import { Action } from '../../ui/controls';
import { businessOn, useBusiness } from '../context';
import { PairingCodeEntry } from '../forms/PairingCodeEntry';
import type { Device, Venue } from '../types';

const time = (epoch: number) => new Date(epoch * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function kioskLine(device: Device, offlineOn = true): string {
  const parts = [device.role === 'standby' ? 'Standby' : 'Home'];
  parts.push(device.online ? 'Online' : device.not_seen_since ? `Not seen since ${time(device.not_seen_since)}` : 'Not seen yet');
  // saved hours only mean something with offline-first playback on (business.offline)
  if (offlineOn && typeof device.saved_hours_ahead === 'number') parts.push(`${Math.round(device.saved_hours_ahead * 10) / 10} h of music saved`);
  if (device.autoplay_allowed === false) parts.push('Needs a tap to start after a restart');
  if (device.wake_lock === false) parts.push('Screen may sleep: turn sleep off on the device');
  return parts.join(' · ');
}

export function KioskPlayers({ venue, disabled }: { venue: Venue; disabled: boolean }) {
  const ctx = useBusiness();
  const [kiosks, setKiosks] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState<Device | null>(null);
  const load = useCallback(async () => {
    try {
      setKiosks(await ctx.client.kiosks(venue.id));
      setError('');
    } catch {
      setError("The players couldn't be loaded. Try again.");
    }
  }, [ctx.client, venue.id]);
  useEffect(() => { void load(); }, [load]);

  const zoneName = (id?: string | null) => venue.zones.find((zone) => zone.id === id)?.name ?? 'Unknown zone';
  const zones = replacing ? venue.zones.filter((zone) => zone.id === replacing.zone_id) : venue.zones;

  return <section aria-labelledby="kiosk-players-title" className="biz-stack">
    <h3 id="kiosk-players-title">Players</h3>
    {kiosks.length === 0 ? <p className="biz-quiet">No players are paired to this venue yet.</p> : <ul className="biz-list">
      {kiosks.map((device) => <li key={device.id}>
        <strong>{device.name}</strong> <span className="biz-quiet">{zoneName(device.zone_id)}</span>
        <p className="biz-quiet">{kioskLine(device, businessOn(ctx.org.features, 'business.offline'))}</p>
        {!disabled && <div className="biz-row">
          <button type="button" onClick={() => setReplacing(device)}>Replace {device.name}</button>
          <Action run={async () => { await ctx.client.unpair(device.id); await load(); }} working="Unpairing">Unpair</Action>
        </div>}
      </li>)}
    </ul>}
    {error && <p role="alert">{error}</p>}
    {!disabled && <>
      <h3>{replacing ? `Replace ${replacing.name}` : 'Pair a player'}</h3>
      {replacing && <p className="biz-quiet">The new player becomes this zone's home player and {replacing.name} stops at once.
        <button type="button" onClick={() => setReplacing(null)}>Cancel</button></p>}
      <PairingCodeEntry key={replacing?.id ?? 'new'} zones={zones} onPair={async (code, zone_id, name) => {
        const device = await ctx.client.pair({ code, zone_id, name, ...(replacing ? { replace_device_id: replacing.id } : {}) });
        setReplacing(null);
        await load();
        await ctx.refresh();
        return device;
      }} isReady={(id) => kiosks.some((d) => d.id === id && d.online)} />
    </>}
  </section>;
}
