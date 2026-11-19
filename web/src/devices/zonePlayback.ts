import { useEffect, useState } from 'react';
import type { Api } from './usePlaybackDevice';

// Which zone this browser is the speaker for (ADR-0443, `GET /api/zones/holding`). A device that
// holds a zone's playback lease is that venue's speaker, so the workspace switcher refuses to
// leave the organisation until the zone is handed back, and the server refuses personal
// "Play here" on the same browser (`holding_zone_lease`). The server reads this workspace's own
// device cookie, so the page doesn't need to know its device id; a browser with no device in the
// organisation holds nothing.

export const HOLDING_ROUTE = '/zones/holding';

/** The zone id this browser holds in `workspaceId`, or null. Never throws: a refusal, a missing
 * device or no network all read as "holding nothing", so the guard never blocks on an error. */
export async function heldZone(api: Api, workspaceId: string): Promise<string | null> {
  try {
    const answer = await api<{ zone_id?: unknown }>(HOLDING_ROUTE, {}, workspaceId);
    return typeof answer?.zone_id === 'string' && answer.zone_id ? answer.zone_id : null;
  } catch {
    return null;
  }
}

/** `heldZone` for a mounted page: asks again whenever `workspaceId` or `refreshKey` changes
 * (the business shell passes its last refresh time). Null while unknown. */
export function useHeldZone(api: Api, workspaceId: string | null | undefined, refreshKey?: unknown): string | null {
  const [zoneId, setZoneId] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) { setZoneId(null); return; }
    let live = true;
    void heldZone(api, workspaceId).then((found) => { if (live) setZoneId(found); });
    return () => { live = false; };
  }, [api, workspaceId, refreshKey]);
  return zoneId;
}

/** The words the switcher names a held zone by: its name when this page lists it, else "a zone"
 * (the switcher's own generic sentence). Null when nothing is held. */
export function heldZoneName(zoneId: string | null, zones: { id: string; name: string }[]): string | null {
  if (!zoneId) return null;
  return zones.find((zone) => zone.id === zoneId)?.name ?? 'a zone';
}
