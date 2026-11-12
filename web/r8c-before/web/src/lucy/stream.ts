import { ApiError } from '../api';
import { lucy } from './client';
import type { LucyEvent } from './types';

/** Lucy's live event log for one conversation. Events arrive once each and in order: anything at or
 * before the last id seen is a replay and is dropped. A gap, or an event in a shape this page doesn't
 * understand, means the page has to start again from a fresh snapshot, so this says `resync` and stops.
 * A hidden tab lets go of the connection after a minute and picks up from where it was when it's back. */

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'paused' | 'resync' | 'refused';

export const EVENT_VERSION = 1;
const HIDDEN_CLOSE_MS = 60_000;
const POLL_MS = 1500;
const POLL_MAX_MS = 15_000;

export function openStream(
  conversationId: string,
  cursor: number,
  onEvents: (events: LucyEvent[]) => void,
  onState: (state: StreamState) => void,
): () => void {
  let lastId = cursor;
  let source: EventSource | null = null;
  let pollTimer: number | undefined;
  let hiddenTimer: number | undefined;
  let pollGeneration = 0;
  let pollDelay = POLL_MS;
  let stopped = false;
  let paused = false;
  let polling = typeof EventSource === 'undefined';

  const closeTransport = () => {
    source?.close();
    source = null;
    pollGeneration += 1;
    window.clearTimeout(pollTimer);
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    closeTransport();
    window.clearTimeout(hiddenTimer);
    document.removeEventListener('visibilitychange', visibility);
  };

  const resync = () => {
    if (stopped) return;
    finish();
    onState('resync');
  };

  /** False when the page has to resync, so the caller stops reading. */
  const accept = (events: LucyEvent[]): boolean => {
    const fresh: LucyEvent[] = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (event.type === 'stream.gap' || event.v !== EVENT_VERSION) {
        if (fresh.length) onEvents(fresh);
        resync();
        return false;
      }
      if (typeof event.id !== 'number' || event.id <= lastId) continue;
      lastId = event.id;
      fresh.push(event);
    }
    if (fresh.length) onEvents(fresh);
    return true;
  };

  const openSource = () => {
    onState('connecting');
    const here = new EventSource(`/api/lucy/conversations/${encodeURIComponent(conversationId)}/events?after=${lastId}`);
    source = here;
    here.onopen = () => {
      if (source === here) onState('live');
    };
    here.addEventListener('lucy', (message) => {
      if (source !== here) return;
      const frame = message as MessageEvent<string>;
      let event: LucyEvent;
      try {
        event = JSON.parse(frame.data) as LucyEvent;
      } catch {
        return;
      }
      if (typeof event?.id !== 'number') {
        const id = Number(frame.lastEventId);
        if (Number.isFinite(id) && event && typeof event === 'object') event.id = id;
      }
      accept([event]);
    });
    here.onerror = () => {
      if (source !== here) return;
      if (here.readyState === EventSource.CLOSED) {
        // Refused outright, as an older server or an error page would. Asking every so often still works.
        here.close();
        source = null;
        polling = true;
        startPolling();
      } else {
        onState('reconnecting');
      }
    };
  };

  const startPolling = () => {
    const mine = ++pollGeneration;
    const tick = async () => {
      if (stopped || paused || mine !== pollGeneration) return;
      try {
        const page = await lucy.events(conversationId, lastId);
        if (stopped || paused || mine !== pollGeneration) return;
        if (page.gap) {
          resync();
          return;
        }
        if (!accept(Array.isArray(page.events) ? page.events : [])) return;
        pollDelay = POLL_MS;
        onState('polling');
      } catch (error) {
        if (stopped || mine !== pollGeneration) return;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          // Lucy was turned off, or this conversation is gone. Asking again won't change that.
          finish();
          onState('refused');
          return;
        }
        pollDelay = Math.min(pollDelay * 2, POLL_MAX_MS);
        onState('reconnecting');
      }
      pollTimer = window.setTimeout(() => void tick(), pollDelay);
    };
    void tick();
  };

  const start = () => {
    if (polling) startPolling();
    else openSource();
  };

  function visibility() {
    if (stopped) return;
    window.clearTimeout(hiddenTimer);
    if (document.visibilityState === 'hidden') {
      hiddenTimer = window.setTimeout(() => {
        if (stopped) return;
        paused = true;
        closeTransport();
        onState('paused');
      }, HIDDEN_CLOSE_MS);
    } else if (paused) {
      paused = false;
      start();
    }
  }

  document.addEventListener('visibilitychange', visibility);
  start();
  return finish;
}
