import { useEffect, useState } from 'react';

// ADR-0475 G70: on the speaker's own screen, briefly and quietly, what another device changed,
// so a person at the speaker is never confused. Gone after a few seconds; never for a seek
// within the song that is playing.

const SHOWN_MS = 4000;

/** What a press from another device changed, in the words the speaker shows ("Paused"), or
 * null when it is not worth saying (a seek within the song, the speaker's own programme). */
export function changeWords(command: string, args: Record<string, unknown> | undefined, songBefore: number | null): string | null {
  if (command === 'set_volume') return Number(args?.volume) === 0 ? 'Muted' : 'Volume changed';
  if (command === 'pause') return 'Paused';
  if (command === 'play') return 'Playing again';
  if (command === 'stop') return 'Stopped';
  if (command === 'skip') return typeof args?.song_index === 'number' && songBefore !== null && args.song_index < songBefore ? 'Went back' : 'Skipped';
  if (command === 'set_programme') return 'Up next changed';
  if (command === 'seek') {
    const target = typeof args?.song_index === 'number' ? args.song_index : null;
    if (target === null || songBefore === null || target === songBefore) return null;
    return target < songBefore ? 'Went back' : 'Skipped';
  }
  return null;
}

export function ChangedFromLine({ change, nameOf }: { change: { deviceId: string; command: string; at: number } | null; nameOf: (deviceId: string) => string | null }) {
  const [shown, setShown] = useState(change);
  useEffect(() => {
    setShown(change);
    if (!change) return undefined;
    const timer = window.setTimeout(() => setShown(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [change]);
  if (!shown) return null;
  return <p className="changed-from" role="status" data-testid="changed-from">{shown.command} from {nameOf(shown.deviceId) ?? 'another device'}.</p>;
}
