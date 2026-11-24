import { useEffect, useState } from 'react';

// ADR-0475 G70: on the speaker's own screen, briefly and quietly, what another device changed,
// so a person at the speaker is never confused. Gone after a few seconds; never for a seek.

const WORDS: Record<string, string> = { set_volume: 'Volume changed', pause: 'Paused', play: 'Playing again', skip: 'Skipped' };
const SHOWN_MS = 4000;

export function ChangedFromLine({ change, nameOf }: { change: { deviceId: string; command: string; at: number } | null; nameOf: (deviceId: string) => string | null }) {
  const [shown, setShown] = useState(change);
  useEffect(() => {
    setShown(change);
    if (!change) return undefined;
    const timer = window.setTimeout(() => setShown(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [change]);
  if (!shown || !WORDS[shown.command]) return null;
  return <p className="changed-from" role="status" data-testid="changed-from">{WORDS[shown.command]} from {nameOf(shown.deviceId) ?? 'another device'}.</p>;
}
