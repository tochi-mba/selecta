import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceHolding, Holdings } from './controller';
import { onReconnect } from '../cloud/connection';

// ADR-0475 holdings as this device sees them: the person's signed-in devices with how many songs
// each can open and whether it is here now, and the catalogue ids the speaker can open. Read from
// GET /local-media/holdings: slowly while nothing changes, and again when the speaker changes or
// reports a new set. Ids only; nothing about files or folders exists on that route.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export const HOLDINGS_EVERY_MS = 15_000;
/** Fired on window by the Cloud event stream when the default speaker changed (ADR-0475 C19). */
export const DEFAULT_SPEAKER_EVENT = 'selecta:default-speaker';
/** ADR-0475 I92: a device reported its songs (`devices.holdings`): read the holdings again now. */
export const HOLDINGS_EVENT = 'selecta:holdings';

export type HoldingsView = {
  /** null until the first answer (or while the route is refused: an older server, the flag off) */
  devices: DeviceHolding[] | null;
  /** The ids the speaker can open; null when there is no speaker elsewhere or it has not said. */
  speakerSongs: ReadonlySet<number> | null;
  /** Each reporting device's ids (ADR-0475 R4, R6: which device holds a song). A device that has
   * reported nothing is absent: unknown, not empty. */
  ids: ReadonlyMap<string, ReadonlySet<number>>;
  /** The account's default speaker (ADR-0475); null when none is set. */
  defaultId: string | null;
  /** Read again now (after the default changed here). */
  refresh: () => void;
};

const NO_IDS: ReadonlyMap<string, ReadonlySet<number>> = new Map();

/** `speakerId`: the device playing elsewhere (its ids are `speakerSongs`); null when none is.
 * Every reporting device's ids are read too, each again only when its report changes. */
export function useHoldings(cloud: Request, enabled: boolean, speakerId: string | null): HoldingsView {
  const [devices, setDevices] = useState<DeviceHolding[] | null>(null);
  const [ids, setIds] = useState<ReadonlyMap<string, ReadonlySet<number>>>(NO_IDS);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
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
        setDefaultId(counts.default_speaker_id ?? null);
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
  }, [cloud, enabled, asked]);

  // a speaker that has reported nothing is unknown, not empty: it answers for itself
  const speakerSongs = speakerId ? ids.get(speakerId) ?? null : null;
  // another device changed the default, or the connection is back: read again now
  useEffect(() => {
    if (!enabled) return undefined;
    const again = () => setAsked((count) => count + 1);
    // (I92: and when a device reports its songs, or this page is looked at again)
    const looked = () => { if (document.visibilityState === 'visible') again(); };
    window.addEventListener(DEFAULT_SPEAKER_EVENT, again);
    window.addEventListener(HOLDINGS_EVENT, again);
    document.addEventListener('visibilitychange', looked);
    const off = onReconnect(again);
    return () => {
      window.removeEventListener(DEFAULT_SPEAKER_EVENT, again);
      window.removeEventListener(HOLDINGS_EVENT, again);
      document.removeEventListener('visibilitychange', looked);
      off();
    };
  }, [enabled]);
  return { devices, speakerSongs, ids, defaultId, refresh: useCallback(() => setAsked((count) => count + 1), []) };
}
