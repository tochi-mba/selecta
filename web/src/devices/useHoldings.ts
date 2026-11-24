import { useEffect, useRef, useState } from 'react';
import type { DeviceHolding, Holdings } from './controller';

// ADR-0475 holdings as this device sees them: the person's signed-in devices with how many songs
// each can open and whether it is here now, and the catalogue ids the speaker can open. Read from
// GET /local-media/holdings: slowly while nothing changes, and again when the speaker changes or
// reports a new set. Ids only; nothing about files or folders exists on that route.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export const HOLDINGS_EVERY_MS = 15_000;

export type HoldingsView = {
  /** null until the first answer (or while the route is refused: an older server, the flag off) */
  devices: DeviceHolding[] | null;
  /** The ids the speaker can open; null when there is no speaker elsewhere or it has not said. */
  speakerSongs: ReadonlySet<number> | null;
  /** Each reporting device's ids (ADR-0475 R4, R6: which device holds a song). A device that has
   * reported nothing is absent: unknown, not empty. */
  ids: ReadonlyMap<string, ReadonlySet<number>>;
};

const NO_IDS: ReadonlyMap<string, ReadonlySet<number>> = new Map();

/** `speakerId`: the device playing elsewhere (its ids are `speakerSongs`); null when none is.
 * Every reporting device's ids are read too, each again only when its report changes. */
export function useHoldings(cloud: Request, enabled: boolean, speakerId: string | null): HoldingsView {
  const [devices, setDevices] = useState<DeviceHolding[] | null>(null);
  const [ids, setIds] = useState<ReadonlyMap<string, ReadonlySet<number>>>(NO_IDS);
  // the report each kept set came from, so an unchanged set is not read again
  const kept = useRef(new Map<string, { reportedAt: number; songs: ReadonlySet<number> }>());

  useEffect(() => {
    if (!enabled) { setDevices(null); setIds(NO_IDS); kept.current = new Map(); return undefined; }
    let live = true;
    const read = async () => {
      try {
        const counts = await cloud<Holdings>('/local-media/holdings');
        if (!live) return;
        setDevices(counts.devices);
        const next = new Map<string, { reportedAt: number; songs: ReadonlySet<number> }>();
        let changed = kept.current.size !== counts.devices.filter((device) => device.reported_at !== null).length;
        for (const device of counts.devices) {
          if (device.reported_at === null) continue;
          const had = kept.current.get(device.device_id);
          if (had && had.reportedAt === device.reported_at) { next.set(device.device_id, had); continue; }
          const one = await cloud<Holdings>(`/local-media/holdings?device_id=${encodeURIComponent(device.device_id)}`);
          if (!live) return;
          next.set(device.device_id, { reportedAt: device.reported_at, songs: new Set(one.song_ids ?? []) });
          changed = true;
        }
        kept.current = next;
        if (changed) setIds(new Map([...next].map(([id, held]) => [id, held.songs])));
      } catch {
        // refused or unreachable: what is known stays; nothing is claimed that was not read
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), HOLDINGS_EVERY_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [cloud, enabled]);

  // a speaker that has reported nothing is unknown, not empty: it answers for itself
  const speakerSongs = speakerId ? ids.get(speakerId) ?? null : null;
  return { devices, speakerSongs, ids };
}
