import { useSyncExternalStore } from 'react';
import { apiOrigin } from './api';

// One connection state for the whole Cloud tab (plan "Nothing is lost", section 1).
//
// Everything that asks the server, the event stream and the browser's own online and offline
// events feed this store, and everything that wants to know "can I reach SelectaDJ right now?"
// reads it: the connection banner, the import, the player, the mix outbox. Nobody guesses from a
// single failed request on their own.
//
// - `online`: the last thing we heard says SelectaDJ answers.
// - `offline`: the browser says it has no network.
// - `unreachable`: the browser has a network but SelectaDJ's service is not answering.
// While offline or unreachable the store probes `/api/status` with a growing wait (2 s doubling to
// 30 s), straight away on the browser's `online` event, and on `probeNow()` (the banner's Try now).
// A probe that gets any answer below 500 means the service is back.

export type ConnectionStatus = 'online' | 'offline' | 'unreachable';

export type ConnectionState = {
  status: ConnectionStatus;
  /** When the connection was first lost this time (ms since epoch), or null while online. */
  since: number | null;
  /** A probe is in flight right now. */
  reconnecting: boolean;
  /** When the next automatic probe runs (ms since epoch), or null. */
  nextTryAt: number | null;
  /** When the connection last came back (ms since epoch), for "Back online. Catching up...". */
  backAt: number | null;
  /** The sign-in ended (a 401 or AuthKit's LoginRequiredError); cleared by the next success. */
  signedOut: boolean;
};

type Listener = () => void;

const FIRST_PROBE_MS = 2_000;
const MAX_PROBE_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;

const browserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

let state: ConnectionState = {
  status: browserOnline() ? 'online' : 'offline',
  since: browserOnline() ? null : Date.now(),
  reconnecting: false,
  nextTryAt: null,
  backAt: null,
  signedOut: false,
};
const listeners = new Set<Listener>();
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let probeFailures = 0;
let probing: Promise<boolean> | null = null;
let probe: () => Promise<boolean> = defaultProbe;
let started = false;

async function defaultProbe(): Promise<boolean> {
  if (typeof fetch === 'undefined') return true;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : undefined;
  try {
    const answer = await fetch(`${apiOrigin}/api/status`, { cache: 'no-store', signal: controller?.signal });
    return answer.status < 500;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function set(next: Partial<ConnectionState>) {
  const merged = { ...state, ...next };
  if (Object.keys(merged).every((key) => merged[key as keyof ConnectionState] === state[key as keyof ConnectionState])) return;
  state = merged;
  for (const listener of [...listeners]) listener();
}

function clearProbe() {
  if (probeTimer !== undefined) clearTimeout(probeTimer);
  probeTimer = undefined;
}

function scheduleProbe() {
  clearProbe();
  if (state.status === 'online') return;
  // with no network at all there is nothing to probe: the browser's `online` event wakes us
  if (!browserOnline()) { set({ nextTryAt: null }); return; }
  const wait = Math.min(MAX_PROBE_MS, FIRST_PROBE_MS * 2 ** probeFailures);
  set({ nextTryAt: Date.now() + wait });
  probeTimer = setTimeout(() => { void probeNow(); }, wait);
}

function lost(status: Exclude<ConnectionStatus, 'online'>) {
  start();
  const wasOnline = state.status === 'online';
  set({ status, since: wasOnline ? Date.now() : state.since ?? Date.now(), backAt: wasOnline ? null : state.backAt });
  if (wasOnline) probeFailures = 0;
  if (probeTimer === undefined || !browserOnline()) scheduleProbe();
}

/** Something reached SelectaDJ and got an answer: the connection is fine. */
export function reportOk(): void {
  clearProbe();
  probeFailures = 0;
  if (state.status === 'online' && !state.signedOut) return;
  const coming = state.status !== 'online';
  set({ status: 'online', since: null, nextTryAt: null, reconnecting: false, signedOut: false, backAt: coming ? Date.now() : state.backAt });
}

/** A request could not reach SelectaDJ (a network error, a timeout, a 502/503/504). */
export function reportUnreachable(): void {
  lost(browserOnline() ? 'unreachable' : 'offline');
}

/** The browser has no network. */
export function reportOffline(): void {
  lost('offline');
}

/** The sign-in ended. The connection itself may be fine; this is said separately. */
export function reportSignedOut(): void {
  set({ signedOut: true });
}

/** Probe the service now (the banner's Try now, the `online` event). Resolves to whether it answered. */
export function probeNow(): Promise<boolean> {
  if (probing) return probing;
  clearProbe();
  set({ reconnecting: true, nextTryAt: null });
  probing = (async () => {
    try {
      const answered = await probe();
      if (answered) { reportOk(); return true; }
      probeFailures += 1;
      set({ reconnecting: false, status: browserOnline() ? 'unreachable' : 'offline', since: state.since ?? Date.now() });
      scheduleProbe();
      return false;
    } finally {
      probing = null;
      if (state.reconnecting) set({ reconnecting: false });
    }
  })();
  return probing;
}

/** Listen for changes; returns the unsubscribe. */
export function subscribe(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The state right now. */
export function getConnection(): ConnectionState {
  return state;
}

/** Whether SelectaDJ is believed reachable right now. */
export function isOnline(): boolean {
  return state.status === 'online' && browserOnline();
}

/** Resolves once the connection is back (at once when it already is). Rejects with an
 * AbortError when `signal` aborts first. */
export function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (isOnline()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const stop = subscribe(() => {
      if (!isOnline()) return;
      done();
      resolve();
    });
    const aborted = () => { done(); reject(abortError()); };
    const done = () => { stop(); signal?.removeEventListener('abort', aborted); };
    signal?.addEventListener('abort', aborted);
    // make sure someone is looking: a store that only heard "offline" probes by itself
    if (state.status === 'online') reportUnreachable();
  });
}

/** Run `work` each time the connection comes back (offline or unreachable, then online). */
export function onReconnect(work: () => void): () => void {
  let was = state.status;
  return subscribe(() => {
    const now = state.status;
    if (now === 'online' && was !== 'online') work();
    was = now;
  });
}

function abortError(): Error {
  try {
    return new DOMException('Stopped while waiting for the connection.', 'AbortError');
  } catch {
    const error = new Error('Stopped while waiting for the connection.');
    error.name = 'AbortError';
    return error;
  }
}

/** Starts listening to the browser's online and offline events (once per tab; idempotent). */
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('offline', () => reportOffline());
  window.addEventListener('online', () => { probeFailures = 0; void probeNow(); });
  // a laptop waking from sleep: look again rather than wait for the timer that slept with it
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.status !== 'online') void probeNow();
    });
  }
}

/** The connection state as a hook. */
export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribe, getConnection, getConnection);
}

/** Why a button that needs the server is disabled right now, or null when it can run. */
export function needsConnectionReason(current: ConnectionState = state): string | null {
  if (current.status === 'offline') return 'This needs the internet. It works again when you are back online.';
  if (current.status === 'unreachable') return 'SelectaDJ’s service isn’t answering right now. This works again once it does.';
  return null;
}

/** For tests and for pages that probe somewhere else: replace the probe, or reset everything. */
export function configureConnection(options: { probe?: () => Promise<boolean>; reset?: boolean }): void {
  if (options.probe) probe = options.probe;
  if (options.reset) {
    clearProbe();
    probeFailures = 0;
    probing = null;
    probe = options.probe ?? defaultProbe;
    state = { status: browserOnline() ? 'online' : 'offline', since: browserOnline() ? null : Date.now(), reconnecting: false, nextTryAt: null, backAt: null, signedOut: false };
    for (const listener of [...listeners]) listener();
  }
}

/** The connection as one object, for callers that prefer `connection.subscribe(...)`. */
export const connection = {
  get: getConnection,
  subscribe,
  isOnline,
  waitForOnline,
  onReconnect,
  probeNow,
  reportOk,
  reportUnreachable,
  reportOffline,
  reportSignedOut,
};
