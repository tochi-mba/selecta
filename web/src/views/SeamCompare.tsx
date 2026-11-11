import { useEffect, useState } from 'react';
import { AudioPreview } from '../ui/AudioPreview';

/** SF-0221-06: A/B only between two real, finished renders of the same transition. A render's key is
 * a hash of exactly what was made, so a key is an immutable clip. Each render this browser has seen
 * finished is remembered per pair; a comparison appears only once there is an earlier, different key
 * for this pair AND the server has confirmed that earlier clip still exists. Nothing is synthesised,
 * and nothing that was only requested, queued or failed is ever offered as a side. */
export type Render = { key: string; label: string };

const seen = new Map<string, Render[]>();

/** The identity of one transition: where it lives and the two songs, in playing order. */
export const pairKey = (scope: number | null, from: number, into: number, position: number) =>
  `${scope ?? 'current'}:${position}:${from}>${into}`;

export function rememberRender(pair: string, render: Render) {
  const list = seen.get(pair) ?? [];
  if (list.some((one) => one.key === render.key)) return;
  seen.set(pair, [...list, render].slice(-4));
}

export function earlierRender(pair: string, now: string): Render | null {
  const list = (seen.get(pair) ?? []).filter((one) => one.key !== now);
  return list[list.length - 1] ?? null;
}

export function forgetRenders() {
  seen.clear();
}

/** Asks for the clip and stops once the server answers: a 200 means it is really there. */
async function clipExists(key: string): Promise<boolean> {
  const stop = new AbortController();
  try {
    const answer = await fetch(`/api/seams/${encodeURIComponent(key)}/preview`, { signal: stop.signal });
    stop.abort();
    return answer.ok;
  } catch {
    return false;
  }
}

export function SeamCompare({ pair, now, title }: { pair: string; now: Render; title: string }) {
  const before = earlierRender(pair, now.key);
  const [verified, setVerified] = useState<string | null>(null);
  const [side, setSide] = useState<'a' | 'b'>('b');
  useEffect(() => {
    let live = true;
    setVerified(null);
    setSide('b');
    if (before) void clipExists(before.key).then((there) => { if (live && there) setVerified(before.key); });
    return () => { live = false; };
  }, [before?.key, now.key]);
  if (!before || verified !== before.key) return null;
  const chosen = side === 'a' ? before : now;
  return (
    <section className="seam-compare stack" aria-label="Compare with before">
      <div className="chips" role="group" aria-label="Which version to hear">
        <button type="button" aria-pressed={side === 'a'} onClick={() => setSide('a')}>A: before ({before.label})</button>
        <button type="button" aria-pressed={side === 'b'} onClick={() => setSide('b')}>B: now ({now.label})</button>
      </div>
      <p className="hint">Both are real renders of this transition. Only B is in the mix.</p>
      <AudioPreview key={chosen.key} src={`/api/seams/${chosen.key}/preview`} autoPlay={false} label={`${title}, ${side === 'a' ? 'before' : 'now'}`} />
    </section>
  );
}
