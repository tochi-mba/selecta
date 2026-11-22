import { useEffect, useState } from 'react';
import { probeNow, useConnection } from './connection';
import { checkedAt } from './offlineCache';
import './connection.css';

/** How long "Back online. Catching up..." stays after the connection returns. */
const BACK_MS = 4_000;

/** The one quiet connection banner (plan "Nothing is lost", section 1, `cloud.offline_shell`).
 *
 * It replaces scattered raw errors with one sentence about the connection and one next step:
 * - offline: SelectaDJ carries on when the connection is back (and keeps playing, in a
 *   local-first shell, whose music is on this device);
 * - the service not answering: when it tries again, with Try now;
 * - just back: "Back online. Catching up..." for a moment.
 * `cachedAt` adds "Showing what this device knows. Last checked 14:05." while the Library is
 * served from this device. Nothing shows while everything is fine. */
export function ConnectionBanner({ plays = false, cachedAt }: {
  /** The music plays from this device, so the banner can promise it keeps playing. */
  plays?: boolean;
  /** When the library shown was last checked with the server, while it is served from this
   * device; null when it never has been here; undefined when it comes from the server. */
  cachedAt?: number | null;
}) {
  const state = useConnection();
  const [now, setNow] = useState(() => Date.now());
  const showingBack = state.status === 'online' && state.backAt !== null && now - state.backAt < BACK_MS;
  // a slow tick only while there is a countdown or a "back online" to clear
  const ticking = (state.status === 'unreachable' && state.nextTryAt !== null) || (state.status === 'online' && state.backAt !== null && now - state.backAt < BACK_MS);
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking, state.backAt, state.nextTryAt]);

  const kept = cachedAt !== undefined
    ? cachedAt === null ? 'Showing what this device knows.' : `Showing what this device knows. Last checked ${checkedAt(cachedAt)}.`
    : null;

  let words: string | null = null;
  let action: { label: string; run: () => void; busy: boolean } | null = null;
  if (state.status === 'offline') {
    words = plays
      ? 'You’re offline. SelectaDJ keeps playing and will carry on when the connection is back.'
      : 'You’re offline. SelectaDJ will carry on when the connection is back.';
  } else if (state.status === 'unreachable') {
    const seconds = state.nextTryAt !== null ? Math.max(1, Math.ceil((state.nextTryAt - now) / 1_000)) : null;
    words = state.reconnecting
      ? 'SelectaDJ’s service isn’t answering. Trying again now.'
      : seconds !== null
        ? `SelectaDJ’s service isn’t answering. Trying again in ${seconds} s.`
        : 'SelectaDJ’s service isn’t answering.';
    action = { label: 'Try now', run: () => void probeNow(), busy: state.reconnecting };
  } else if (showingBack) {
    words = 'Back online. Catching up...';
  }

  // the status region stays mounted, so a screen reader hears each change once
  return (
    <div className="connection-banner" role="status" aria-live="polite" data-state={words ? state.status : 'quiet'} hidden={!words && !kept}>
      {(words || kept) && (
        <p className="connection-banner-words">
          {words}
          {words && kept ? ' ' : ''}
          {kept && <span className="connection-banner-kept">{kept}</span>}
        </p>
      )}
      {action && (
        <button type="button" className="quiet connection-banner-action" onClick={action.run} disabled={action.busy} aria-busy={action.busy || undefined}>
          {action.label}
        </button>
      )}
    </div>
  );
}
