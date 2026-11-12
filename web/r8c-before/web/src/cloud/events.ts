import { useEffect, useRef, useState } from 'react';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { apiOrigin } from './api';

// One server-sent event stream per signed-in tab (docs/saas/11-ui-ux.md §11.3).
//
// The browser's EventSource can't send an Authorization header, so the stream is read with
// fetch. Every event carries its outbox id; the last one seen is kept for this tab and sent back
// as Last-Event-ID, so a reconnect (the server ends each stream after ten minutes, or when the
// token expires) carries on from where it stopped instead of missing or repeating anything.
//
// When the stream can't be had (a proxy blocks it, the network drops, the answer isn't a
// stream, or it goes silent past the 20-second heartbeat), the tab falls back to polling: the
// pages ask the server for what they show, on a timer, until the stream comes back. It keeps
// trying the stream with a growing wait, and catches up once when it does.

export type CloudEvent = { id: number; topic: string; payload: unknown };
export type StreamState = 'connecting' | 'live' | 'polling';

export type StreamOptions = {
  token: () => Promise<string>;
  workspaceId: string;
  onEvent: (event: CloudEvent) => void;
  onState: (state: StreamState) => void;
  fetchImpl?: typeof fetch;
  /** The longest the stream may go without a byte before it counts as blocked. */
  silenceMs?: number;
  /** The first wait before trying the stream again; it doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
};

const LAST_ID = 'selecta.cloud.last-event-id';

function rememberedId(workspaceId: string): number {
  try {
    const stored = JSON.parse(sessionStorage.getItem(LAST_ID) ?? 'null') as { workspace: string; id: number } | null;
    return stored && stored.workspace === workspaceId && Number.isInteger(stored.id) ? stored.id : 0;
  } catch { return 0; }
}

function remember(workspaceId: string, id: number) {
  try { sessionStorage.setItem(LAST_ID, JSON.stringify({ workspace: workspaceId, id })); } catch { /* storage may be off */ }
}

/** Split complete frames off the front of `buffer`; what's left is an unfinished frame. */
export function parseFrames(buffer: string): { events: { id?: number; data: string }[]; rest: string } {
  const events: { id?: number; data: string }[] = [];
  const normalised = buffer.replace(/\r\n/g, '\n');
  const frames = normalised.split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    let id: number | undefined;
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id' && /^\d+$/.test(value)) id = Number(value);
      if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ id, data: data.join('\n') });
  }
  return { events, rest };
}

export function openEventStream(options: StreamOptions): { close: () => void } {
  const fetcher = options.fetchImpl ?? fetch;
  const silenceMs = options.silenceMs ?? 45_000;
  const firstRetry = options.retryMs ?? 2_000;
  const maxRetry = options.maxRetryMs ?? 30_000;
  let closed = false;
  let controller: AbortController | null = null;
  let wait: number | undefined;
  let lastId = rememberedId(options.workspaceId);
  let failures = 0;

  const fail = () => {
    if (closed) return;
    failures += 1;
    options.onState('polling');
    const delay = Math.min(maxRetry, firstRetry * 2 ** (failures - 1));
    wait = window.setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    const mine = controller;
    let silence: number | undefined;
    const quiet = () => {
      window.clearTimeout(silence);
      silence = window.setTimeout(() => mine.abort(), silenceMs);
    };
    if (failures === 0) options.onState('connecting');
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await options.token()}`,
        'X-Workspace-ID': options.workspaceId,
        Accept: 'text/event-stream',
      };
      if (lastId > 0) headers['Last-Event-ID'] = String(lastId);
      quiet();
      const response = await fetcher(`${apiOrigin}/api/events`, { headers, signal: mine.signal, cache: 'no-store' });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !response.body || !type.includes('text/event-stream')) throw new Error('No event stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // The server has answered with a stream: it's live. A proxy that holds the bytes back is
      // caught by the silence timer, since the server sends a heartbeat every 20 seconds.
      let heard = false;
      failures = 0;
      options.onState('live');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        heard = true;
        quiet();
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.events) {
          let event: CloudEvent;
          try { event = JSON.parse(frame.data) as CloudEvent; } catch { continue; }
          const id = frame.id ?? event.id;
          if (typeof id === 'number' && id <= lastId) continue; // already seen
          if (typeof id === 'number') { lastId = id; remember(options.workspaceId, id); }
          options.onEvent(event);
        }
      }
      window.clearTimeout(silence);
      // The server ends a stream on purpose (ten minutes, token expiry): pick it straight up.
      if (!closed) {
        // An empty stream that ends at once is refused in all but name: back off as for a failure.
        if (!heard) { fail(); return; }
        wait = window.setTimeout(() => void connect(), 250);
      }
    } catch {
      window.clearTimeout(silence);
      if (!closed) fail();
    }
  };

  void connect();
  return {
    close: () => {
      closed = true;
      window.clearTimeout(wait);
      controller?.abort();
    },
  };
}

/** The stream as a hook: calls `onEvent` for each event and `refresh` whenever the pages may be
 * out of date (each poll while the stream is down, and once when it comes back). */
export function useCloudEvents({ token, workspaceId, onEvent, refresh, pollMs = 10_000, fetchImpl }: {
  token: () => Promise<string>;
  workspaceId: string | null;
  onEvent: (event: CloudEvent) => void;
  refresh: () => void | Promise<unknown>;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const handlers = useRef({ token, onEvent, refresh });
  handlers.current = { token, onEvent, refresh };
  const previous = useRef<StreamState>('connecting');

  useEffect(() => {
    if (!workspaceId) return;
    const stream = openEventStream({
      workspaceId,
      fetchImpl,
      token: () => handlers.current.token(),
      onEvent: (event) => handlers.current.onEvent(event),
      onState: (next) => {
        // Coming back from polling: anything missed while away is fetched once.
        if (next === 'live' && previous.current === 'polling') void handlers.current.refresh();
        previous.current = next;
        setState(next);
      },
    });
    return () => stream.close();
  }, [workspaceId, fetchImpl]);

  useVisiblePoll(() => handlers.current.refresh(), pollMs, state === 'polling');
  return state;
}
