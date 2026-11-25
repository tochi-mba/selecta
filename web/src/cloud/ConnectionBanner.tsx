import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from '../feel/root';
import { usePresence } from '../ui/exitMotion';
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
export function ConnectionBanner({ plays = false, cachedAt, signedOutOffline = false }: {
  /** The music plays from this device, so the banner can promise it keeps playing. */
  plays?: boolean;
  /** When the library shown was last checked with the server, while it is served from this
   * device; null when it never has been here; undefined when it comes from the server. */
  cachedAt?: number | null;
  /** Opened offline before the sign-in could be renewed (CloudApp's offline mode). */
  signedOutOffline?: boolean;
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

  const kept = cachedAt !== undefined && !signedOutOffline
    ? cachedAt === null ? 'Showing what this device knows.' : `Showing what this device knows. Last checked ${checkedAt(cachedAt)}.`
    : null;

  let words: string | null = null;
  let action: { label: string; run: () => void; busy: boolean } | null = null;
  if (signedOutOffline && state.status !== 'online') {
    words = 'You’re offline. Showing what this device knows; you’ll be signed in again when the connection is back.';
    if (state.status === 'unreachable') action = { label: 'Try now', run: () => void probeNow(), busy: state.reconnecting };
  } else if (state.status === 'offline') {
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

  // ADR-0477: the banner slides open and, when it has nothing more to say, slides shut on the exit
  // protocol (ui/exitMotion.ts), still showing its last words so it never closes empty. "Back online"
  // draws a tick. Without motion it appears and goes at once, as before.
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const shown = usePresence<HTMLDivElement>(!!(words || kept), '--motion-exit-drawer');
  const lastWords = useRef(words);
  if (words) lastWords.current = words;
  const said = words ?? (shown.closing ? lastWords.current : null);
  // this region is hidden, never removed, so the closing mark must go once it has closed
  const region = shown.ref;
  useLayoutEffect(() => {
    if (!shown.closing) region.current?.removeAttribute('data-closing');
  }, [shown.closing, shown.present, region]);

  // the status region stays mounted, so a screen reader hears each change once
  return (
    <div ref={shown.ref} className="connection-banner" role="status" aria-live="polite" data-state={words ? state.status : 'quiet'} hidden={!shown.present}>
      {(said || kept) && (
        <p className="connection-banner-words">
          {moving && showingBack && words && (
            <svg className="connection-banner-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          )}
          {said}
          {said && kept ? ' ' : ''}
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
