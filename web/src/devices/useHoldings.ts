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
};

/** `speakerId`: the device playing elsewhere, whose ids are worth reading; null reads counts only. */
export function useHoldings(cloud: Request, enabled: boolean, speakerId: string | null): HoldingsView {
  const [devices, setDevices] = useState<DeviceHolding[] | null>(null);
  const [speakerSongs, setSpeakerSongs] = useState<ReadonlySet<number> | null>(null);
  // the report the kept ids came from, so an unchanged set is not read again
  const kept = useRef<{ id: string; reportedAt: number | null } | null>(null);

  useEffect(() => {
    if (!enabled) { setDevices(null); setSpeakerSongs(null); kept.current = null; return undefined; }
    let live = true;
    const read = async () => {
      try {
        const counts = await cloud<Holdings>('/local-media/holdings');
        if (!live) return;
        setDevices(counts.devices);
        const speaker = speakerId ? counts.devices.find((device) => device.device_id === speakerId) : undefined;
        if (!speakerId || !speaker) { kept.current = null; setSpeakerSongs(null); return; }
        if (kept.current?.id === speakerId && kept.current.reportedAt === speaker.reported_at) return;
        // a speaker that has reported nothing is unknown, not empty: it answers for itself
        if (speaker.reported_at === null) { kept.current = { id: speakerId, reportedAt: null }; setSpeakerSongs(null); return; }
        const one = await cloud<Holdings>(`/local-media/holdings?device_id=${encodeURIComponent(speakerId)}`);
        if (!live) return;
        kept.current = { id: speakerId, reportedAt: speaker.reported_at };
        setSpeakerSongs(new Set(one.song_ids ?? []));
      } catch {
        // refused or unreachable: what is known stays; nothing is claimed that was not read
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), HOLDINGS_EVERY_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [cloud, enabled, speakerId]);

  return { devices, speakerSongs };
}
