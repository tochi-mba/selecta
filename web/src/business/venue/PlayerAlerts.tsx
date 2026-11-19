// The venue's player alerts (ADR-0445 BZ-0445-10, ADR-0453 Needs attention): a silent zone, a
// player offline ("may still be playing"), a player that needs a tap or pairing again, a refused
// copy of a player's sign-in. They are read from the server and read again whenever the shell
// refreshes, which it does on every `zone.` event, so a new `zone.alert` shows within seconds.
// Acknowledging stops the 15-minute escalation to organisation admins; the alert still closes
// by itself when the music comes back. Shown only while `business.kiosk` is on.

import { useCallback, useEffect, useState } from 'react';
import { Action } from '../../ui/controls';
import { useBusiness } from '../context';
import type { ZoneAlert } from '../types';

export function PlayerAlerts({ venueId }: { venueId: string }) {
  const ctx = useBusiness();
  const [items, setItems] = useState<ZoneAlert[]>([]);
  const load = useCallback(async () => {
    try {
      setItems(await ctx.client.zoneAlerts(venueId));
    } catch {
      // the next refresh tries again; the rest of the page does not depend on this
    }
  }, [ctx.client, venueId]);
  useEffect(() => { void load(); }, [load, ctx.updatedAt]);
  if (!items.length) return null;
  return <section className="biz-card" role="region" aria-labelledby="player-alerts-title">
    <h2 id="player-alerts-title">Players that need a look</h2>
    <ul className="biz-list">
      {items.map((alert) => <li key={alert.id}>
        <p><strong>{alert.zone_name}</strong> {alert.text}</p>
        {alert.acknowledged_at
          ? <p className="biz-quiet">Acknowledged</p>
          : !ctx.readOnly && <Action run={async () => { await ctx.client.acknowledgeZoneAlert(alert.id); await load(); }} working="Acknowledging">Acknowledge</Action>}
      </li>)}
    </ul>
  </section>;
}
